# Kesişen / eksik dosyalar (route geneli) — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 90 bulgu · Severity: High 11, Medium 29, Low 50

## F51 — not-found / error / global-error sayfaları yok: 404 ve render hataları İngilizce, menüsüz, kurtarma eylemsiz

| Alan                | Değer                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                            |
| Durum               | Doğrulandı                                                                                                                                                                                                                                      |
| Konum               | `src/app/not-found.tsx`                                                                                                                                                                                                                         |
| Diğer konumlar      | `src/app/error.tsx:0`, `src/app/global-error.tsx:0`, `src/app/property/[id]/page.tsx:121`, `src/app/dev/mailbox/page.tsx:7`, `src/app/page.tsx:36`, `src/app/layout.tsx:42`, `src/app/booking/[id]/page.tsx:103`, `messages/tr/property.json:3` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                            |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                     |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                             |
| WCAG                | 3.1.2                                                                                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                                                                           |
| Efor                | M                                                                                                                                                                                                                                               |
| Kaynak denetçiler   | lens:status, lens:mobile, lens:nav, lens:nav                                                                                                                                                                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: global)                                                                                                                                                                                                           |

**Kanıt:** src/app altında not-found.tsx, error.tsx, global-error.tsx, loading.tsx yok (find sonucu boş). property/[id]/page.tsx:121 ve dev/mailbox/page.tsx:7 `notFound()` çağırıyor; Next varsayılanı 'This page could not be found.' İngilizce ve kök layout'ta Header olmadığından (layout.tsx:42-71; Header PageShell ve sayfa bileşenlerinde) menüsüz. page.tsx:36 getPopularProperties ve property/[id]/page.tsx sunucu sorguları hata verirse varsayılan hata ekranı çıkıyor. Next 16.3 dokümanı (docs/01-app/03-api-reference/03-file-conventions/error.md:117-157) `retry` prop'unu stabil sunuyor. messages/tr/property.json:3 `notFoundTitle: 'Property Bulunamadı'` karışık dil. booking/[id]/page.tsx:103-113 hata durumunda yalnız 'Hata' + sunucu mesajı + 'Ana sayfaya dön'; 404/403 ayrımı yok.

**Etki:** Yayından kalkmış ilanın paylaşılan bağlantısını açan TR misafir İngilizce, menüsüz ve aramaya dönüşü olmayan bir sayfada kalır; standalone PWA'da geri düğmesi de yok. Geçici DB/Redis kesintisinde ana sayfa ve ilan tamamen düşer, 'Tekrar dene' yok.

**Önerilen aksiyon:** src/app/not-found.tsx (sunucu bileşeni): `PageShell` (Header+Footer içerir) ile getTranslations('common') h1 'Sayfa bulunamadı', açıklama, SearchBar, 'Ana sayfa' ve 'Rezervasyonlarım' bağlantıları. src/app/property/[id]/not-found.tsx: 'Bu ilan artık yayında değil' + /search bağlantısı. src/app/error.tsx ('use client'): PageShell içinde çevrili h1 'Bir şeyler ters gitti', `retry()` çağıran `Button` 'Tekrar dene', ana sayfa/Yardım bağlantıları, mount'ta h1'e odak. src/app/global-error.tsx: kendi `<html lang>`/`<body>`'si, globals.css importu, kısa TR/EN metin ve retry (mevcut sınıflar, palet değişmeden). property.json notFoundTitle'ı 'İlan bulunamadı' yapın. booking/[id] hata durumunda ApiError.status 404/403'ü ayırıp /account bağlantısı ekleyin.

**Yapılan düzeltme:** New src/app/not-found.tsx: server component, PageShell (Header, Footer, #main, h1), common.notFound.* text, nav with Home and /search links (min-h 44px, existing Button variant classes and focusRing), metadata title. New src/app/error.tsx: client component using { error, retry }, Header/Footer/#main, localized h1 with tabIndex=-1 that gets focus on mount (no role=alert), Button 'Tekrar dene' calls retry(), home link, digest reference via common.errorPage.reference. New src/app/global-error.tsx: its own <html lang='tr'><body>, imports globals.css, <title>, static TR + EN (lang='en') text, retry button, plain <a href='/'>. Patch sets property.notFoundTitle to 'İlan bulunamadı' / 'Listing not found'. Not done (other owners): property/[id]/not-found.tsx, and splitting 404/403 on booking/[id]. — dosyalar: `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`

## F52 — Sunucu ve istemci hata metinleri sabit Türkçe ve ham gösteriliyor; EN arayüzde Türkçe hata, ağ kesintisinde 'Failed to fetch'

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/lib/api-client.ts:40`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Diğer konumlar      | `src/components/ui/ui.tsx:266`, `src/lib/http/errors.ts:27`, `src/lib/http/errors.ts:154`, `src/components/booking/BookingActions.tsx:79`, `src/app/checkout/page.tsx:143`, `src/app/login/page.tsx:61`, `src/app/search/page.tsx:210`, `src/components/cart/AddToCartButton.tsx:65`, `src/app/checkout/cart/page.tsx:93`, `src/components/booking/BookingMessages.tsx:93`, `src/components/support/SupportChat.tsx:66`, `src/components/host/HostDashboard.tsx:222`, `src/components/host/PayoutPanel.tsx:87`, `src/components/host/AccessibilityPanel.tsx:93`, `src/lib/pricing/revenue.ts:469`, `src/lib/compliance/accessibility.ts:155`, `src/components/booking/useQuote.ts:117` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Prensip             | robustness · recoverability (hata mesajları) / consistency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| WCAG                | 3.1.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Efor                | L                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Kaynak denetçiler   | area:host, area:host2, lens:status, lens:copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: global)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Kanıt:** api-client.ts:40 `let message = `İstek başarısız (${res.status})`` ve :45 `if (body.error) message = body.error;` sunucu metni ApiError.message olur. Sunucu metinleri sabit TR: lib/http/errors.ts:27 'Oturum açmanız gerekiyor', :34, :41, :48 'Kayıt bulunamadı', :154 'Doğrulama hatası' (Zod, hangi alan olduğu yok), :167 'Eşzamanlı işlem çakışması…'. UI bunları kod eşlemeden basıyor: BookingActions.tsx:79,180,200,228 `err instanceof ApiError ? err.message : …`, checkout/page.tsx:143, login/page.tsx:61,67, search/page.tsx:210,243, AddToCartButton.tsx:65, checkout/cart/page.tsx:93,162, BookingMessages.tsx:93,107, SupportChat.tsx:66 `errorMessage(err)`. apiFetch:65 `fetch` try/catch'siz olduğundan ağ kesintisinde tarayıcının TypeError'ı ('Failed to fetch'/'Load failed') Error olarak `err.message` ile ekrana çıkıyor. ui.tsx:266-268 `errorMessage` yalnız Error olmayan değerlerde fallback kullanıyor; yani 'fallback verilmeden çağrılıyor' iddiası ikincil, asıl sorun `error.message`'ın doğrudan render edilmesi. İyi örnek zaten var: resolution/shared.tsx `useClaimErrorText` (ClaimDetail/ClaimMessages/ClaimAdmin kullanıyor) ve BookingMessages.tsx:91 MESSAGE_BLOCKED → t().

**Etki:** EN arayüzü seçen misafir ödeme, giriş, sepet ve fiyat hatalarını; ev sahibi/yönetici panel hatalarını Türkçe görür ve ne yapacağını anlayamaz. Ekran okuyucu lang='en' sayfada Türkçe metni İngilizce sesle okur. Tüm kullanıcılar ağ kesintisinde teknik İngilizce 'Failed to fetch' görür. 'Doğrulama hatası' hangi alanın hatalı olduğunu söylemez.

**Önerilen aksiyon:** 1) api-client.ts apiFetch'te `fetch`'i try/catch'e alın; TypeError'da `throw new ApiError(0, '', 'NETWORK')`. toApiError'daki sabit TR varsayılanı kaldırıp yalnız status/code/details taşıyın. 2) resolution/shared.tsx'teki useClaimErrorText desenini genelleştiren `useApiErrorText()` hook'unu ui.tsx'e ekleyin: önce `t(`common.errors.${code}`)` (messages/tr|en/common.json'a `errors` bloğu: NETWORK 'Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.', UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, TRANSACTION_CONFLICT, SERVICE_UNAVAILABLE, PAYMENT_PROVIDER_ERROR, INVALID_CARD_TOKEN, HOLD_EXPIRED, EMAIL_NOT_VERIFIED, RATE_LIMITED, INVALID_STATE vb.), bilinmeyen kodda çağıranın verdiği çevrili fallback; `err.message` asla doğrudan render edilmesin. 3) VALIDATION_ERROR'da `details.fieldErrors` anahtarlarını ilgili `Field`'ın `error` prop'una bağlayın. 4) Listelenen çağrı yerlerini (BookingActions, checkout, login, search, AddToCartButton, checkout/cart, BookingMessages, SupportChat, host panelleri) bu hook'a geçirin; errorMessage() varsayılan TR fallback'ini kaldırıp çevrili fallback'i zorunlu yapın.

**Yapılan düzeltme:** Lib-side support only, no behavior change. Added isNetworkError(err) to api-client.ts so callers can detect a fetch TypeError. Added common.errors.* keys to the patch (NETWORK, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, TRANSACTION_CONFLICT, RATE_LIMITED, SERVICE_UNAVAILABLE), ready for a shared hook. Did not wrap fetch to throw ApiError: checkout/cart/page.tsx:46 and pay/share/[token]/page.tsx:43 branch on !(err instanceof ApiError) to show a translated fallback, so wrapping would put raw text on screen there. Hook and caller migration are listed in crossOwner. Server-side message localization needs a backend change. — dosyalar: `src/lib/api-client.ts`

## F53 — Yeni mesajdan haberdar olma yolu yok: bildirim, okunmamış sayacı ve okundu durumu bulunmuyor

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                   |
| Durum               | Doğrulandı                                                                                             |
| Konum               | `src/lib/messaging/message-service.ts:161`                                                             |
| Diğer konumlar      | `src/lib/messaging/hub.ts:47`, `src/components/host/HostDashboard.tsx:172`, `prisma/schema.prisma:614` |
| Kullanıcılar        | misafir, ev sahibi                                                                                     |
| Prensip             | robustness · observability                                                                             |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                         |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | L                                                                                                      |
| Kaynak denetçiler   | area:trips                                                                                             |
| **Düzeltme durumu** | **Atlandı** (paket: global)                                                                            |

**Kanıt:** sendMessage yalnız `await publishMessage(bookingId, event)` (161) çağırıyor; hub.ts:47-53 yalnız Redis yayını (en iyi çaba). Bildirim şablonları (lib/notifications/templates.ts) ve push (push/notifications.ts:54,101) yalnız fiyat düşüşü ve check-in için. prisma/schema.prisma:614-628 Message modelinde readAt/lastReadAt yok. HostDashboard.tsx:172-175 '/host/messages/{id}' bağlantısında sayı/rozet yok.

**Etki:** Alıcı mesajı yalnız ilgili sayfa açıksa görür. Ev sahibi geç giriş gibi soruları kaçırır, misafir giriş talimatını kaçırır; ev sahibi her rezervasyonu tek tek açarak yoklamak zorunda kalır.

**Önerilen aksiyon:** sendMessage sonunda karşı tarafa bildirim: lib/notifications/templates.ts'e `newMessage` şablonu ('{ilan} için yeni mesaj', misafire /booking/{id}, ev sahibine /host/messages/{id}) ve sendPushToUser(…,'new_message',…). MessageThread'e katılımcı başına `guestLastReadAt`/`hostLastReadAt` ekleyip listMessages GET'inde güncelleyin. HostDashboard.tsx:172'deki bağlantıda 'Mesajlar (2 yeni)' metnini gösterin (sayı görünür metinde olsun, yalnız renkle değil); misafir hesap/trips kartına aynı sayacı ekleyin.

**Yapılan düzeltme:** needs backend/API change: needs a notification template, push on sendMessage, and readAt/lastReadAt in the schema.

## F54 — İstemci kütüphanelerinde sabit Türkçe hata metinleri (kart doğrulama, passkey, yeniden doğrulama iptali)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Konum               | `src/lib/payment/card-token.ts:56`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Diğer konumlar      | `src/lib/payment/card-token.ts:58`, `src/lib/payment/card-token.ts:61`, `src/components/booking/BookingActions.tsx:163`, `src/app/checkout/cart/page.tsx:114`, `src/app/pay/share/[token]/page.tsx:119`, `src/components/transfers/ClaimForm.tsx:57`, `src/lib/auth/passkey-client.ts:85`, `src/components/booking/StepUpDialog.tsx:44`, `src/components/account/ReauthDialog.tsx:16`, `src/components/account/ReauthDialog.tsx:61`, `src/components/privacy/PrivacyCenter.tsx:51` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Prensip             | learnability · consistency (dil tutarlılığı)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| WCAG                | 3.1.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: global)                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Kanıt:** card-token.ts:56 'Kart numarası geçersiz', :58 'CVC geçersiz', :61 'Kartın son kullanma tarihi geçmiş' → BookingActions.tsx:163, checkout/cart/page.tsx:114, pay/share/[token]/page.tsx:119, transfers/ClaimForm.tsx:57 `err instanceof CardValidationError ? err.message : …`. passkey-client.ts:84-86 NotAllowedError/InvalidStateError için sabit TR döner; StepUpDialog.tsx:44 ve ReauthDialog.tsx:61 bunu gösterir, oysa PasskeyManager.tsx:35-38 aynı durumları t('passkeys.cancelled') ile çeviriyor. ReauthDialog.tsx:16 `super('Yeniden doğrulama iptal edildi')`; PrivacyCenter.tsx:51 `errorMessage(err)` kullanıcı pencereyi kendi kapattığında bunu role=alert kırmızı hata olarak gösteriyor. (PropertyCard.tsx:71 'Favori kaldırılamadı' hiç render edilmiyor, bu bulgudan çıkarıldı.)

**Etki:** EN misafir ödeme formunda kart hatasını ve riskli ödemede passkey iptalini Türkçe görür. Hesap silme penceresini 'Vazgeç' ile kapatan kullanıcı hata yapmış gibi kırmızı uyarı alır.

**Önerilen aksiyon:** CardValidationError'a `code` alanı ekleyin (CARD_NUMBER_INVALID, CVC_INVALID, CARD_EXPIRED) ve 4 çağrı yerinde `t(`errors.${err.code}`)` (messages/*/payment.json) kullanın. passkeyErrorMessage'ı `(err, t, fallback)` imzasına çevirip PasskeyManager.tsx:33-40'taki eşlemeyi ortak hale getirin; StepUpDialog ve ReauthDialog bunu kullansın. PrivacyCenter.tsx:50-52'de `if (err instanceof ReauthCancelledError) { setBusy(false); return; }` ile sessizce geçin.

**Yapılan düzeltme:** CardValidationError now carries an optional code (CARD_NUMBER_INVALID | CVC_INVALID | CARD_EXPIRED) and tokenizeCard sets it; message text is unchanged, so nothing breaks. Added passkeyErrorCode(err) -> 'CANCELLED' | 'ALREADY_REGISTERED' | null to passkey-client.ts. Added payment.errors.* keys to the patch. Moving call sites to t() and handling ReauthCancelledError are other owners' work (crossOwner). — dosyalar: `src/lib/payment/card-token.ts`, `src/lib/auth/passkey-client.ts`

## F55 — PWA manifest kurulu uygulamayı dikey yöne kilitliyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | High                                      |
| Durum               | Doğrulandı                                |
| Konum               | `src/lib/pwa/manifest.ts:26`              |
| Diğer konumlar      | `src/app/manifest.webmanifest/route.ts:8` |
| Kullanıcılar        | tümü                                      |
| Prensip             | accessibility · WCAG 1.3.4 Orientation    |
| Sezgisel madde      | H14 — Erişilebilirlik                     |
| WCAG                | 1.3.4                                     |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | lens:mobile                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: global)            |

**Kanıt:** manifest.ts:25-26 `display: 'standalone', orientation: 'portrait'`; app/manifest.webmanifest/route.ts:8 buildManifest ile sunuluyor. İçerikte yönü zorunlu kılan bir özellik yok.

**Etki:** Cihazı yatay sabitleyen kullanıcılar (sandalyeye monte tablet, klavye kılıflı tablet) kurulu uygulamayı döndüremiyor; takvim ve tablolarda yatay genişlikten mahrum kalıyor. Yalnız kurulu PWA (Android/masaüstü standalone) modunu etkiler.

**Önerilen aksiyon:** manifest.ts:26'daki `orientation` satırını kaldırın ya da `'any'` yapın; ardından yatay ~360px yükseklikte sabit bantları (demo şeridi, sticky header) ve diyalogları test edin.

**Yapılan düzeltme:** src/lib/pwa/manifest.ts: orientation 'portrait' -> 'any' (WCAG 1.3.4), with a comment. No test refers to orientation. — dosyalar: `src/lib/pwa/manifest.ts`

## F110 — Karşılaştırma sayfası, aynı tarih ve misafir için kartta gösterilenden yaklaşık %11 yüksek toplam fiyat gösteriyor (farklı fiyat planı)

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | High                                                                    |
| Durum               | Gözlemlendi                                                             |
| Konum               | `src/lib/ai/listing-compare.ts:256`                                     |
| Diğer konumlar      | `src/components/compare/CompareBar.tsx:221`, `src/app/compare/page.tsx` |
| Kullanıcılar        | misafir                                                                 |
| Prensip             | learnability · Tutarlılık: aynı varlık için farklı fiyat                |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                             |
| Renk/tema           | Hayır                                                                   |
| Efor                | M                                                                       |
| Kaynak denetçiler   | runtime:results                                                         |
| **Düzeltme durumu** | **Atlandı** (paket: global)                                             |

**Kanıt:** RUNTIME p4e.mjs ve p5b.mjs (27-29.01.2027, 2 misafir): Arama kartında Grand Deluxe Hotel ₺4.647,33 ve Sultanahmet ₺3.372,22 görünüyor ("vergi ve ücretler dahil", ratePlan …tg1490l7, "Erken rezervasyon %10" uygulanmış). /compare sayfası "Toplam fiyat ₺5.163,70" ve "₺3.746,90" gösteriyor (/api/compare ratePlanId …rxgzh099). İlan sayfası ₺4.647,33 gösteriyor, ₺5.163,70 üstü çizili. "En uygun fiyat" rozeti indirimsiz fiyatlara göre hesaplanıyor. KOD: listing-compare.ts:256-263'te createQuote ratePlanId verilmeden çağrılıyor, bu yüzden varsayılan plan seçiliyor.

**Etki:** Misafir karşılaştırmada daha pahalı bir fiyat görüyor; bu güveni zedeliyor ve sıralama kararını bozabiliyor. Para konusunda bir tutarsızlık.

**Önerilen aksiyon:** priceFor içinde her uygun oda için tüm rezerve edilebilir fiyat planlarını deneyip en düşük charge.total değerini seçin, ya da aramanın priceStay'deki en iyi plan mantığını yeniden kullanın. CompareBar bağlantısına roomId ve ratePlanId taşıyın. Karşılaştırma hücresinde de "vergi ve ücretler dahil" ibaresi olsun.

**Yapılan düzeltme:** needs backend/API change: listing-compare.ts priceFor picks a rate plan (business logic), not a UI text issue.

## F111 — Sunucu kaynaklı metinler EN arayüzde Türkçe: maske etiketleri, uzunluk hatası

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | High                                                                                 |
| Durum               | Gözlemlendi                                                                          |
| Konum               | `src/lib/messaging/mask.ts:25`                                                       |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx`, `src/lib/messaging/message-service.ts` |
| Kullanıcılar        | misafir, ev sahibi                                                                   |
| Prensip             | accessibility · Consistency / familiarity                                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                          |
| WCAG                | 3.1.2 Language of Parts (AA)                                                         |
| Renk/tema           | Hayır                                                                                |
| Efor                | M                                                                                    |
| Kaynak denetçiler   | runtime:trips                                                                        |
| **Düzeltme durumu** | **Atlandı** (paket: global)                                                          |

**Kanıt:** p-variants.mts EN bölümü (NEXT_LOCALE=en): gönderilen 'Call me on +44 7911 123456 tomorrow' balonu 'Guest: Call me on [telefon gizlendi] tomorrow … · contact details hidden' (etiket Türkçe, alt not İngilizce); 2100 karakterlik gönderimde role=alert 'Mesaj en fazla 2000 karakter olabilir'. Maske etiketi DB'deki gövdeye yazılıyor (mask.ts:19-26), hata metni sunucuda sabit (message-service.ts:135) ve istemci err.message'ı aynen basıyor (BookingMessages.tsx:93).

**Etki:** İngilizce konuşan misafir/ev sahibi neyin gizlendiğini ve hatanın nedenini anlayamıyor; ekran okuyucu Türkçe metni İngilizce telaffuzla okuyor.

**Önerilen aksiyon:** DB'ye dil bağımsız token (ör. '⟦PHONE⟧') yazın, istemcide maskedKinds ile yerelleştirilmiş çip olarak gösterin; BookingMessages'ta ApiError.code/details'i çeviri anahtarına eşleyin (VALIDATION_ERROR+max -> t('tooLong',{max})).

**Yapılan düzeltme:** needs backend/API change: mask labels are written into the stored message body and the length error text is set on the server; fixing this needs a language-neutral token and error code.

## F112 — Maskeleme tarih/saat, Wi-Fi şifresi, kapı kodunu '[telefon gizlendi]' yapıyor; gönderen önceden uyarılmıyor, geri alınamıyor

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | High                                                                                 |
| Durum               | Gözlemlendi                                                                          |
| Konum               | `src/lib/messaging/mask.ts:34`                                                       |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx`, `src/lib/messaging/message-service.ts` |
| Kullanıcılar        | misafir, ev sahibi                                                                   |
| Prensip             | robustness · Recoverability + observability                                          |
| Sezgisel madde      | H5 — Hata önleme                                                                     |
| Renk/tema           | Hayır                                                                                |
| Efor                | M                                                                                    |
| Kaynak denetçiler   | runtime:trips                                                                        |
| **Düzeltme durumu** | **Atlandı** (paket: global)                                                          |

**Kanıt:** Gerçek maskMessage modülü tsx ile çalıştırıldı (probes/booking/mask-check.ts, mask-check2.ts): 'Uçuş TK2412, 24.10.2026 14:30'da iniyorum' -> 'Uçuş TK2412, [telefon gizlendi]:30'da iniyorum'; 'Tarih 24.10.2026-27.10.2026 arası' -> 'Tarih [telefon gizlendi].2026 arası'; 'Wi-Fi şifresi 1234567890' -> '[telefon gizlendi]'; 'Kapı kodu 2024 10 24 15' -> '[telefon gizlendi]'. UI probu p-booking.mts B9 (POST yanıtı gerçek maskMessage ile üretildi): balon 'Merhaba, uçağım TK2412 [telefon gizlendi]:30'da iniyor, beni [telefon gizlendi]'den arayın', altında yalnızca 12px gri 'iletişim bilgisi gizlendi' (text-xs text-gray-500); hangi parçanın neden gizlendiği yok. Ekran: scratchpad/runtime/probes/booking/booking-msg-masked-desktop.png. Gönderim öncesi hiçbir uyarı yok; mask.ts başlık yorumuna göre DB'de yalnız maskeli metin tutuluyor (geri dönüşsüz).

**Etki:** Mesajlaşmanın birincil amacı olan varış saati/tarihi ve ev sahibinin check-in talimatları (kapı kodu, Wi-Fi) sessizce yok oluyor; iki taraf da eksik bilgiyle hareket ediyor, platform dışı iletişime itiliyor.

**Önerilen aksiyon:** INTL_PHONE_RE'yi tarih (dd.mm.yyyy), saat (hh:mm) ve aralık kalıplarını hariç tutacak şekilde daraltın (ör. önce tarih/saat token'larını koruyun, telefon için 0/+ önekli 10–12 hane şartı). Aynı deseni paylaşılan modülden istemcide de çalıştırıp gönderim öncesi 'Şu kısım gizlenecek: …' önizlemesi ve düzenleme imkânı verin. Gönderim sonrası gizlenen parçaları vurgulayın ve türünü yazın ('telefon numarasına benzeyen kısım gizlendi').

**Yapılan düzeltme:** needs backend/API change: changing the masking regex is security/business logic; the pre-send preview belongs to the BookingMessages owner.

## F113 — Yeni mesaj için okunmamış göstergesi ve bildirim yok — mesajlar ancak ilgili sayfa açıkken görülüyor

| Alan                | Değer                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                              |
| Durum               | Gözlemlendi                                                                                                       |
| Konum               | `src/lib/messaging/message-service.ts:161`                                                                        |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx`, `src/components/booking/BookingMessages.tsx`, `src/lib/messaging/hub.ts` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                |
| Prensip             | robustness · Observability                                                                                        |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                    |
| Renk/tema           | Hayır                                                                                                             |
| Efor                | L                                                                                                                 |
| Kaynak denetçiler   | runtime:trips                                                                                                     |
| **Düzeltme durumu** | **Atlandı** (paket: global)                                                                                       |

**Kanıt:** Tarama 072 (misafir) ve 100 (host) Tab sırası başlık öğeleri: Konaklama, Gezi planla, Devir pazarı, Sepetim, Destek, (Ev sahibi paneli), Posta kutusu (demo), Tema, Dil, Hesabım, Çıkış yap — mesaj girişi/rozeti yok. Ev sahibi tablosunda her satırda yalnızca düz 'Mesajlar' bağlantısı (HostDashboard.tsx:171-176, sayı yok). sendMessage yalnızca Redis pub/sub'a yayın yapıyor (message-service.ts:161 publishMessage -> hub.ts:49); e-posta/push/okunmamış kaydı yok (src/lib altında başka referans bulunamadı).

**Etki:** Misafirin 'erken giriş mümkün mü?' sorusu ev sahibi o rezervasyonun sayfasını tesadüfen açana kadar görülmüyor; misafir de ev sahibinin talimatlarını kaçırıyor. Platform içi iletişim güvenilmez olunca kullanıcılar platform dışına kayıyor (maskelemenin amacına ters).

**Önerilen aksiyon:** Katılımcı başına lastReadAt tutun; başlığa 'Mesajlar (n)' rozeti ve ev sahibi tablosuna okunmamış sayısı ekleyin; alıcı SSE'ye bağlı değilse mevcut push/e-posta altyapısıyla (src/lib/push/notifications.ts) 'Yeni mesaj' bildirimi gönderin.

**Yapılan düzeltme:** needs backend/API change (duplicate of F53): unread counter and new-message notification need schema and service changes.

## F114 — İngilizce arayüzde ödeme hataları, 3DS ipucu ve passkey hataları Türkçe

| Alan                | Değer                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                         |
| Durum               | Gözlemlendi                                                                                                  |
| Konum               | `src/lib/payment/card-token.ts:56`                                                                           |
| Diğer konumlar      | `src/lib/payment/mock-psp.ts`, `src/lib/auth/passkey-client.ts`, `src/components/booking/BookingActions.tsx` |
| Kullanıcılar        | misafir                                                                                                      |
| Prensip             | accessibility · Familiarity ve consistency: arayüz dili tutarlı olmalı                                       |
| Sezgisel madde      | H9 — Hata mesajları                                                                                          |
| WCAG                | 3.1.2 Language of Parts (AA)                                                                                 |
| Renk/tema           | Hayır                                                                                                        |
| Efor                | M                                                                                                            |
| Kaynak denetçiler   | runtime:checkout                                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: global)                                                                        |

**Kanıt:** RUNTIME probes/checkout/p9-en.mjs (masaüstü, NEXT_LOCALE=en, sayfa lang=en, 'Payment', 'Pay and confirm' İngilizce). Geçersiz numara için [alert] 'Kart numarası geçersiz', kısa CVC için 'CVC geçersiz', 01/21 için 'Kartın son kullanma tarihi geçmiş', red kartı için 'Ödeme reddedildi. Lütfen başka bir kart deneyin.' görüldü. 3DS formunda '3D Secure verification | Demo doğrulama kodu: 123456 | Verify' yazıyor. p8-stepup mobile EN'de 'Ödeme doğrulaması için kullanılabilir passkey yok (yeni passkey'ler 24 saat bekler) Manage my passkeys'. KOD: card-token.ts:56,58,61 sabit Türkçe metin. mock-psp.ts:49 Türkçe hint. passkey-client.ts:84-86 Türkçe. BookingActions.tsx:163,180 ApiError.message'ı doğrudan gösteriyor.

**Etki:** Türkçe bilmeyen misafir ödemesinin neden başarısız olduğunu anlayamıyor. Ekran okuyucu Türkçe metni İngilizce sesle okuyor.

**Önerilen aksiyon:** Hata kodları (CARD_NUMBER_INVALID, CVC_INVALID, CARD_EXPIRED, PAYMENT_DECLINED, NO_PASSKEY…) döndürülsün, metinler istemcide next-intl ile payment.errors.* anahtarlarından seçilsin. 3DS ipucu da sunucudan bir kod ve değişkenlerle gelsin, ApiError.message yalnızca bilinmeyen kodlarda yedek olarak kullanılsın.

**Yapılan düzeltme:** Same fix as F54 (card error codes, passkey code helper, payment.errors keys). The 3DS hint in mock-psp and server-side payment messages need a backend/API change. — dosyalar: `src/lib/payment/card-token.ts`, `src/lib/auth/passkey-client.ts`

## F260 — Rezervasyon akışındaki eylem adları yanıltıcı: 'Rezervasyonu Onayla' yalnızca checkout'a götürüyor, 'Tamamla' da sadece oda tutuyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                                                                                                             |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `messages/tr/booking.json:16`                                                                                                                                                                                                                                                                                                                    |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:126`, `src/components/booking/BookingWidget.tsx:247-253`, `src/app/checkout/page.tsx:167`, `src/app/checkout/page.tsx:230-236`, `messages/tr/checkout.json:10`, `messages/tr/payment.json:16`, `messages/tr/plan.json:17-19`, `messages/tr/cart.json:38`, `src/components/plan/TripPlanner.tsx:88-105` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                                          |
| Prensip             | learnability · predictability / feedforward                                                                                                                                                                                                                                                                                                      |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                                                                                                                                                                                                |
| WCAG                | 3.2.4                                                                                                                                                                                                                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                            |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                                                                                                                                 |
| **Düzeltme durumu** | **Atlandı** (paket: global)                                                                                                                                                                                                                                                                                                                      |

**Kanıt:** messages/tr/booking.json:16 `"submit": "Rezervasyonu Onayla"` (EN "Confirm booking") BookingWidget.tsx:252'de kullanılıyor, ama :126'daki handler yalnızca `router.push(`/checkout?${params}`)` yapıyor. Checkout'ta başlık ve gönder düğmesi aynı: messages/tr/checkout.json:10 `"title": "Rezervasyonu Tamamla"` (checkout/page.tsx:167 ve :235). Bu düğme HELD bir rezervasyon oluşturuyor, ardından detay sayfasında payment.json:16 `"payAndConfirm": "Öde ve onayla"` geliyor. Aynı 'oda tutma' işlemi plan.json:17'de `"Tut (hold)"`, cart.json:38'de `"Odaları tut"` olarak adlandırılıyor. TripPlanner.tsx:88-105 ise fiyat dökümü ve kupon adımı olmadan doğrudan `POST /api/bookings` yapıyor.

**Etki:** Misafir ilk adımda 'onayladım' sanıp sayfadan ayrılabilir, ikinci adımda 'tamamladım' sanıp ödemeyi yarıda bırakabilir. HELD süresi dolunca rezervasyon düşer. Para ve tarih hatasına toleransı düşük kullanıcı için durum ile eylem eşleşmiyor. Üç farklı giriş noktası (tek oda, sepet, gezi planı) aynı işlemi üç farklı adla ve farklı adım sayısıyla yaptırıyor.

**Önerilen aksiyon:** Adları akıştaki gerçek adıma göre verin: widget.submit → "Devam et: bilgileri gözden geçir"; checkout.title → "Rezervasyonu gözden geçir", gönder düğmesi → "Odayı ayır ve ödemeye geç"; payAndConfirm aynı kalsın ("Öde ve onayla · {tutar}"). 'Tut' kavramı için tek terim seçilip (ör. "Odayı ayır") cart.checkout.hold ve plan.result.hold'da kullanılsın, "(hold)" kaldırılsın. Checkout başlığının altına adım göstergesi ekleyin (1 Gözden geçir, 2 Öde, 3 Onay). TripPlanner'daki 'Tut' düğmesi doğrudan rezervasyon oluşturmak yerine checkout'a parametrelerle yönlendirsin.

**Yapılan düzeltme:** needs other owner: renaming means changing BookingWidget, checkout page (h1 and button share one key), cart and plan texts, and the exact names are used by e2e tests (a11y.spec.ts:54,62,264; booking-flow.spec.ts:36; helpers.ts). Requested changes are listed in crossOwner.

## F382 — TR terminoloji ve yazım tutarsızlığı: 'Parola' / 'Şifre', 'Giriş Yap' / 'Giriş yap'

| Alan                | Değer                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                   |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                           |
| Konum               | `messages/tr/auth.json:3`                                                                                                                                                                                                                                |
| Diğer konumlar      | `messages/tr/auth.json:9`, `messages/tr/auth.json:41`, `messages/tr/auth.json:46`, `messages/tr/nav.json:4`, `messages/tr/account.json:73`, `src/lib/auth/password-policy.ts:6`, `messages/tr/nav.json`, `messages/en/nav.json`, `messages/en/auth.json` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                     |
| Prensip             | learnability · consistency                                                                                                                                                                                                                               |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                    |
| Efor                | S                                                                                                                                                                                                                                                        |
| Kaynak denetçiler   | area:auth, lens:consistency, lens:copy, runtime:auth                                                                                                                                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                             |

**Kanıt:** auth.json:3 `"password": "Parola"` ve :24 'Parola en az…' ile :9 'Şifremi unuttum', :31, :39 'Yeni şifre belirleyin', :41-45 'Yeni şifre / Şifreyi değiştir / Şifreniz değişti'. Giriş formunda 'Parola' etiketinin hemen altında 'Şifremi unuttum' bağlantısı var (login/page.tsx:101,116). Sunucu mesajları password-policy.ts:6-8 'Parola…', account.json:73 'Parola'. Büyük harf: auth.json:7,10,28 'Giriş Yap', :16,19,25 'Kayıt Ol' ile :46 'Giriş yap' ve nav.json:4-5 'Giriş yap', 'Kayıt ol'. R1-923'teki auth dışı tutarsızlıklar (mülk/tesis/ilan, '...'/'…', 'Property Bulunamadı') ayrı kovaya aittir.

**Etki:** Aynı kavram aynı ekranda iki farklı kelimeyle geçer; düşük okuryazarlıktaki misafir 'parola' ile 'şifre'nin farklı şeyler olduğunu düşünebilir. Header ile kart arasındaki yazım farkı da arayüzü özensiz gösterir.

**Önerilen aksiyon:** Tek terim seçin ('Şifre', 'Şifremi unuttum' ile uyumlu). Değiştirilecek yerler: auth.json:3,24, account.json:73 (ve :72,:84 'parolanızı'), password-policy.ts:6,8 sunucu mesajları. Düğme ve bağlantılarda cümle düzenini kural yapın: auth.json:7,10,16,19,25,28 → 'Giriş yap', 'Kayıt ol'.

## F399 — 'Devir pazarı' / 'Transfer market' etiketi belirsiz

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | Medium                                                          |
| Durum               | Doğrulandı                                                      |
| Konum               | `messages/en/nav.json:7`                                        |
| Diğer konumlar      | `messages/tr/nav.json:7`, `src/components/layout/Header.tsx:22` |
| Kullanıcılar        | misafir                                                         |
| Prensip             | learnability · familiarity                                      |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                     |
| Renk/tema           | Hayır                                                           |
| Efor                | S                                                               |
| Kaynak denetçiler   | area:shell                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                    |

**Kanıt:** nav.json en 'transfers': 'Transfer market', tr 'transfers': 'Devir pazarı'; Header.tsx:22 ana menüde. Sayfa açıklaması (transfers/page.tsx yorumu) özelliğin 'Rezervasyon devri' olduğunu söylüyor. Seyahat bağlamında 'transfer' genellikle havalimanı transferi anlamına gelir; 'devir' hukuki bir terim.

**Etki:** EN misafir havalimanı transferi bekleyerek tıklar; TR misafir öğenin başkasının rezervasyonunu devralmak/satmak olduğunu anlamaz.

**Önerilen aksiyon:** messages/en/nav.json 'transfers' → 'Booking resale' (ya da 'Resold bookings'), messages/tr/nav.json 'transfers' → 'Rezervasyon devri'. transfers.page.intro'nun ilk cümlesinin tek cümlelik bir tanım olduğundan emin olun.

## F400 — Sunucu-render sayfalara geçişte yükleniyor geri bildirimi yok (loading.tsx eksik)

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                |
| Durum               | Doğrulandı                                                                                                            |
| Konum               | `src/app/property/[id]/loading.tsx`                                                                                   |
| Diğer konumlar      | `src/app/page.tsx:10`, `src/components/property/PropertyCard.tsx:134`, `src/components/property/PropertyCard.tsx:190` |
| Kullanıcılar        | misafir                                                                                                               |
| Prensip             | robustness · responsiveness                                                                                           |
| Sezgisel madde      | H15 — Performans                                                                                                      |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | S                                                                                                                     |
| Kaynak denetçiler   | lens:status                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                          |

**Kanıt:** Projede hiç loading.tsx yok ve useLinkStatus kullanılmıyor. property/[id]/page.tsx:106-124 render önce getProperty + listPublicFeatures sorgularını bekliyor; page.tsx:10 force-dynamic. PropertyCard.tsx:134 ve :190 `<Link href={href}>` ile gezinmede segment için yükleme sınırı olmadığından eski sayfa göstergesiz ekranda kalıyor.

**Etki:** Yavaş mobil ağda misafir ilan kartına dokunduktan sonra tepki görmez, tekrar dokunur ya da geri döner; algılanan hız düşer.

**Önerilen aksiyon:** src/app/property/[id]/loading.tsx ekleyin: Header + başlık/galeri/rezervasyon kutusu iskeleti (mevcut gri tonlarla) ve `<p role='status' className='sr-only'>İlan yükleniyor…</p>` (çevrili). src/app/loading.tsx için hafif iskelet. Alternatif/ek olarak PropertyCard bağlantısında `useLinkStatus()` ile pending iken küçük bir 'Yükleniyor…' göstergesi.

## F401 — İsteklerde zaman aşımı yok; şifre sıfırlama ağ hatasında 'Kaydediliyor' durumunda kilitleniyor

| Alan                | Değer                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                      |
| Durum               | Doğrulandı                                                                                                                  |
| Konum               | `src/lib/api-client.ts:65`                                                                                                  |
| Diğer konumlar      | `src/app/reset-password/page.tsx:20`, `src/components/booking/BookingActions.tsx:318`, `src/app/checkout/cart/page.tsx:344` |
| Kullanıcılar        | tümü                                                                                                                        |
| Prensip             | robustness · responsiveness                                                                                                 |
| Sezgisel madde      | H15 — Performans                                                                                                            |
| Renk/tema           | Hayır                                                                                                                       |
| Efor                | S                                                                                                                           |
| Kaynak denetçiler   | lens:status                                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                |

**Kanıt:** api-client.ts:65 `let res = await fetch(path, init);` signal/timeout yok (sw.js yalnız /trips ve /api/itinerary için 4 sn zaman aşımlı). BookingActions.tsx:318 `busy ? t('processing')` ve checkout/cart/page.tsx:344-346 yanıt gelene dek kalıyor. reset-password/page.tsx:18-22 `setState('saving')` sonrası `await fetch(...)` try/catch'siz; ağ hatasında promise reddi yakalanmıyor ve state 'saving'de kalıyor.

**Etki:** Zayıf mobil ağda misafir ödeme ekranında süresiz 'İşleniyor…' görüp sayfayı yeniler (ödeme alınıp alınmadığını bilmeden). Şifre sıfırlayan kullanıcı ağ kesintisinde hiçbir mesaj görmez ve yenilemeden ilerleyemez.

**Önerilen aksiyon:** apiFetch'e çağıranın signal'i yoksa `AbortSignal.timeout(20000)` ekleyin (ödeme uçlarında 45 sn); TimeoutError'da `ApiError(0,'','TIMEOUT')` fırlatın ve ödeme akışında 'İstek zaman aşımına uğradı. Ödemenizin durumunu kontrol ediyoruz…' gösterip rezervasyon durumunu yeniden okuyun (Idempotency-Key zaten var). reset-password submit'ini try/catch'e alın; catch'te `setState('idle')` ve `setError(t('reset.failed'))`.

## F402 — Oturum süresi dolduğunda global akış yok: hata metni giriş bağlantısı içermiyor, giriş dönüşü kaldığı yere götürmüyor

| Alan                | Değer                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                       |
| Durum               | Doğrulandı                                                                                                                                                                   |
| Konum               | `src/lib/api-client.ts:66`                                                                                                                                                   |
| Diğer konumlar      | `src/components/ui/ui.tsx:219`, `src/components/host/HostDashboard.tsx:218`, `src/components/resolution/ClaimMessages.tsx:55`, `src/components/property/PropertyCard.tsx:84` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                    |
| Prensip             | robustness · recoverability                                                                                                                                                  |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                        |
| Efor                | M                                                                                                                                                                            |
| Kaynak denetçiler   | lens:status                                                                                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                 |

**Kanıt:** api-client.ts:66-69 401'de bir kez /api/auth/refresh deneniyor; başarısızsa 'Oturum açmanız gerekiyor' ApiError'ı çağırana düz metin olarak gidiyor (ör. HostDashboard.tsx:218-222, ClaimMessages). ui.tsx:219 RoleGate giriş bağlantısı `href='/login'` — login/page.tsx:63 `redirect` parametresini desteklediği halde verilmiyor. Kod tabanında beforeunload yok; sessionStorage yalnız checkout/page.tsx:28'de. Ek: PropertyCard.tsx:79-85 favori 401'inde `err.message.includes('401')` hiç eşleşmiyor (mesaj 'Favori eklenemedi'), oturumsuz kullanıcı favoriye tıkladığında ne geri bildirim ne yönlendirme alıyor.

**Etki:** Uzun ilan/karar formu dolduran ev sahibi veya yönetici yalnız düz bir metin görür; girişe gidip dönerse yazdıkları kaybolur ve aynı sayfaya dönmez. Misafir favori düğmesine bastığında hiçbir şey olmaz.

**Önerilen aksiyon:** apiFetch'te refresh başarısız olunca `window.dispatchEvent(new CustomEvent('session-expired'))`; NextIntlClientProvider içine role=alertdialog `SessionExpiredDialog` ('Oturumunuzun süresi doldu. Giriş yaptıktan sonra bu sayfaya döneceksiniz.') ekleyin; mevcut ReauthDialog/useReauth ile yerinde yeniden giriş, olmazsa `/login?redirect=${encodeURIComponent(pathname+search)}`. RoleGate Link'ine aynı redirect'i ekleyin. Host açıklama, claim ve mesaj textarea'larını sessionStorage'a taslak yazıp dönüşte geri yükleyin. PropertyCard'da `res.status === 401` kontrolüyle `/login?redirect=…`'e yönlendirin, diğer hatalarda Status ile çevrili mesaj gösterin.

## F403 — Oturum kontrolü ağ/sunucu hatasını 'giriş yapmamış' sayıyor; Header her gezinmede önce 'Giriş yap' gösteriyor

| Alan                | Değer                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                        |
| Durum               | Doğrulandı                                                                                                    |
| Konum               | `src/lib/api-client.ts:82`                                                                                    |
| Diğer konumlar      | `src/components/ui/ui.tsx:214`, `src/components/layout/Header.tsx:47`, `src/components/layout/Header.tsx:122` |
| Kullanıcılar        | tümü                                                                                                          |
| Prensip             | robustness · observability                                                                                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                |
| Renk/tema           | Hayır                                                                                                         |
| Efor                | M                                                                                                             |
| Kaynak denetçiler   | lens:status                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                  |

**Kanıt:** api-client.ts:82-88 fetchCurrentUser her hatayı `catch { return null; }` ile oturumsuz sayıyor → ui.tsx:214-226 RoleGate 'Bu sayfa için giriş yapın' gösteriyor. Header.tsx:47 `useState<SessionUser|null>(null)`, :50-58 her pathname değişiminde yeniden çekiyor ve :122-137 kullanıcı gelene kadar 'Kayıt Ol / Giriş Yap' render ediyor; Header PageShell ve sayfa bileşenlerinde olduğundan her gezinmede yeniden mount oluyor, rol menüleri (Header.tsx:24-28) sonradan beliriyor.

**Etki:** Oturumu açık ev sahibi/yönetici sunucu yavaşken veya geçici hatada 'giriş yapın' görüp tekrar giriş yapmaya çalışır; misafir her sayfa geçişinde bir an çıkış yapılmış gibi bir başlık görür ve düzen kayar.

**Önerilen aksiyon:** fetchCurrentUser yalnız 401/403'te null dönsün, diğer hatalarda fırlatsın; useSession'a `status: 'error'` ekleyip RoleGate'te `Status` ile 'Oturum bilgisi alınamadı' + `Button` 'Tekrar dene' gösterin. Header'da yükleme durumunu ayrı tutun (`undefined` = yükleniyor) ve bu sırada giriş butonları yerine aynı genişlikte `aria-hidden` yer tutucu render edin; kullanıcıyı modül düzeyinde önbelleğe alarak sayfalar arası koruyun.

## F404 — Yapay zekâ yanıt taslağı arayüz ve misafir dilinden bağımsız olarak Türkçe üretiliyor

| Alan                | Değer                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                   |
| Durum               | Doğrulandı                                                                                               |
| Konum               | `src/lib/messaging/message-service.ts:223`                                                               |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:103`, `src/app/api/bookings/[id]/messages/draft/route.ts:15` |
| Kullanıcılar        | ev sahibi                                                                                                |
| Prensip             | robustness · task conformance                                                                            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                              |
| Renk/tema           | Hayır                                                                                                    |
| Efor                | S                                                                                                        |
| Kaynak denetçiler   | area:trips                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                             |

**Kanıt:** message-service.ts:223 sistem istemi 'Ev sahibi adına misafire kısa, nazik bir Türkçe yanıt taslağı yaz.' sabit. api/bookings/[id]/messages/draft/route.ts POST locale okumuyor; BookingMessages.tsx:103-105 istek gövdesiz gönderiliyor.

**Etki:** EN arayüz kullanan veya İngilizce yazan yabancı misafire yanıt veren ev sahibi Türkçe taslak alır; özellik uluslararası misafirler için kullanışsız kalır.

**Önerilen aksiyon:** draft route'unda `resolveLocale(req.cookies.get(LOCALE_COOKIE)?.value)` (manifest route.ts:7'deki gibi) okuyup draftHostReply'a `locale` geçin; istemi `${locale === 'en' ? 'English' : 'Türkçe'}` ile parametreleyin (tercihen son misafir mesajının dilini öncelikleyin). BookingMessages'ta taslak doldurulunca 'Taslak dili: İngilizce' notu gösterin.

## F405 — Destek asistanı yanıtlarında ham kodlar (MODERATE, CONFIRMED, saat dilimi) ve iki kez basılan uzun talep kimliği

| Alan                | Değer                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                      |
| Durum               | Doğrulandı                                                                                                  |
| Konum               | `src/lib/support/agent.ts:147`                                                                              |
| Diğer konumlar      | `src/lib/support/agent.ts:156`, `src/lib/support/agent.ts:90`, `src/components/support/SupportChat.tsx:110` |
| Kullanıcılar        | misafir                                                                                                     |
| Prensip             | learnability · familiarity (gerçek dünya eşleşmesi)                                                         |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                 |
| Renk/tema           | Hayır                                                                                                       |
| Efor                | S                                                                                                           |
| Kaynak denetçiler   | area:misc                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                |

**Kanıt:** agent.ts:146-147 `(${p.timeZone}). İptal politikası: ${p.policyKind}` ham enum ve 'Europe/Istanbul' yazıyor (support/tools.ts:81 policyKind = snapshot.kind). agent.ts:155-156 `durum ${s.status}` (tools.ts:73 b.status ham). agent.ts:89-91 TICKET_REF cuid'i yanıt metnine ekliyor ve SupportChat.tsx:110-114 aynı id'yi `t('handoff', { id })` (support.json:13) ile ikinci kez basıyor.

**Etki:** TR arayüzde 'MODERATE', 'CONFIRMED' gibi İngilizce kodlar görünür; 25 karakterlik talep numarası okunup telefonda söylenemez ve aynı balonda iki kez yer alır.

**Önerilen aksiyon:** agent.ts'te policyKind ve status için locale'e göre etiket eşlemesi ekleyin (mevcut booking/policy çeviri anahtarlarıyla aynı metinler, ör. MODERATE → 'Orta esneklikte iptal', CONFIRMED → 'Onaylandı'); timeZone yerine '(tesis saati)'/'(property local time)' yazın. TICKET_REF'i yanıt metninden çıkarın; SupportChat'te yalnız kısa referansı (`id.slice(-6).toUpperCase()`) bir 'Kopyala' `Button`'u ile tek yerde gösterin.

## F406 — AI asistanı kapalıyken 'İnsana bağlan' da çalışmıyor; alternatif kanal gösterilmiyor

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                   |
| Durum               | Doğrulandı                                                                               |
| Konum               | `src/lib/support/agent.ts:231`                                                           |
| Diğer konumlar      | `src/components/support/SupportChat.tsx:78`, `src/components/support/SupportChat.tsx:66` |
| Kullanıcılar        | misafir                                                                                  |
| Prensip             | robustness · recoverability                                                              |
| Sezgisel madde      | H9 — Hata mesajları                                                                      |
| Renk/tema           | Hayır                                                                                    |
| Efor                | S                                                                                        |
| Kaynak denetçiler   | area:misc                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                             |

**Kanıt:** agent.ts:231-232 `if (!settings.supportAgentEnabled) throw new ServiceUnavailableError('Destek asistanı şu anda kapalı')` kontrolü :259'daki zorunlu devirden (`input.requestHuman ? 'USER_REQUEST'`) önce çalışıyor. SupportChat.tsx:78 `connectHuman = () => void ask(t('humanMessage'), true)` aynı uca gidiyor; :65-66 catch'te yalnız `errorMessage(err)` (sabit TR metin).

**Etki:** AI kapalı/bakımdayken misafirin insana ulaşma yolu da kapanır; ekranda alternatif iletişim bilgisi olmadan yalnız 'Destek asistanı şu anda kapalı' görünür.

**Önerilen aksiyon:** runSupportChat'te requestHuman=true ve para/hukuk devir sinyallerini supportAgentEnabled kontrolünden önce işleyin (openTicket LLM gerektirmiyor). SupportChat catch'inde `err.code === 'SERVICE_UNAVAILABLE'` için çevrili 'Asistan şu an kapalı; İnsana bağlan düğmesiyle ekibimize yazabilirsiniz' + destek e-postası gösterin ve 'İnsana bağlan' düğmesini etkin bırakın.

## F510 — Sıralama dipnotu var olmayan bir sıralama seçeneğinden ('en çok beğenilen') bahsediyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Gözlemlendi                                           |
| Konum               | `messages/tr/ranking.json:33`                         |
| Diğer konumlar      | `messages/en/ranking.json`, `messages/tr/search.json` |
| Kullanıcılar        | misafir                                               |
| Prensip             | learnability · Consistency                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                           |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | runtime:compliance                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** Sweep 026/027'nin gövde metni: 'Fiyat, puan veya en çok beğenilen sıralamalarını seçtiğinizde yalnızca o ölçüt kullanılır.' (EN: 'most liked'). Arama sıralama seçenekleri yalnızca Önerilen, 'Fiyat (önce en düşük)', 'Fiyat (önce en yüksek)' ve 'Puan (önce en yüksek)' (messages/tr/search.json:29-34). 'En çok beğenilen' diye bir seçenek yok.

**Etki:** Yasal şeffaflık metni gerçek arayüzle çelişiyor. Kullanıcı olmayan bir seçeneği arıyor ve metnin doğruluğuna güveni azalıyor.

**Önerilen aksiyon:** Dipnotu gerçek etiketlerle yazın, mümkünse search.sort mesajlarından türetin: 'Fiyat (önce en düşük/yüksek) veya Puan (önce en yüksek) seçildiğinde yalnız o ölçüt kullanılır.'

## F511 — Seed verisi: Barselona etkinlikleri Roma'ya bağlı; kuyrukta 'Barselona Primavera Fest · Roma' görünüyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Gözlemlendi                                           |
| Konum               | `prisma/seed.ts:99`                                   |
| Kullanıcılar        | admin, misafir                                        |
| Prensip             | robustness · Gerçek dünya eşleşmesi ve veri bütünlüğü |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                           |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | runtime:admin                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** Sweep 104 body: 'Barselona Primavera Fest · Roma · 04.12.2026–11.12.2026 · etki 7/10 · Onaylı' ve 'Barselona Formula E · Roma' (crops/admin/104-admin-tr-desktop-_admin-1.png). seed.ts:99-100 loc:12 kullanıyor; LOCATIONS dizisinde index 12=Roma, 13=Barselona (seed.ts:56-57). Diğer etkinliklerin indeksleri doğru.

**Etki:** Talep sinyali Barselona yerine Roma fiyatlarını etkiliyor. Admin kuyrukta çelişkili veri görüp sisteme güvenini yitiriyor.

**Önerilen aksiyon:** seed.ts:99-100'de loc değerini 13 yapın. Bu tür hataları önlemek için indeks yerine şehir adıyla eşleme kullanın.

## F512 — Cüzdan 'tamamlanan konaklama yok' derken aynı sayfada 'Tamamlandı' rezervasyon görünüyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Medium                                                                       |
| Durum               | Gözlemlendi                                                                  |
| Konum               | `prisma/seed.ts:1345`                                                        |
| Diğer konumlar      | `src/lib/wallet/wallet-service.ts`, `src/components/account/WalletPanel.tsx` |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | robustness · Tutarlılık / durum görünürlüğü (Dix: consistency)               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                               |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | runtime:account                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                 |

**Kanıt:** Tarama 060/061/126 metni: Cüzdan 'Henüz tamamlanan konaklama yok… 2 konaklama sonra Gümüş seviyesi' ve 'Kullanılabilir kredi: Henüz krediniz yok', aynı sayfada 'İzmir Alsancak Apart Hotel — Tamamlandı (15–19 Eylül 2026)'. Neden: seed.ts:1335-1347 rezervasyonu doğrudan COMPLETED oluşturuyor; completedStays yalnız onStayCompleted (wallet-service.ts:336-346) ile loyaltyAccount'a yazılıyor.

**Etki:** Misafir cashback/seviye sistemine güvenini kaybeder ('konaklamam sayılmadı'), destek talebine yol açar; demo inandırıcılığı zayıflar.

**Önerilen aksiyon:** Seed'de COMPLETED rezervasyonlar için onStayCompleted (veya loyaltyAccount upsert + loyaltyCashback) çağır. UI'da tamamlanan rezervasyon sayısı ile cüzdan sayısı farklıysa 'Cashback'iniz iade penceresinden sonra eklenecek' açıklaması göster.

## F513 — Otomatik tamamlama otel adlarını ve yaygın İngilizce yer adlarını tanımıyor ('Sonuç bulunamadı'); yer tutucu ise 'Şehir, otel veya bölge' vaat ediyor, oysa arama bunları buluyor

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Medium                                                                      |
| Durum               | Gözlemlendi                                                                 |
| Konum               | `src/app/api/locations/route.ts:11`                                         |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx`                         |
| Kullanıcılar        | misafir                                                                     |
| Prensip             | learnability · Learnability / predictability; Robustness / task conformance |
| Sezgisel madde      | H13 — Feedforward                                                           |
| Renk/tema           | Hayır                                                                       |
| Efor                | M                                                                           |
| Kaynak denetçiler   | runtime:home                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** RUNTIME probes/home/combobox2.mjs (TR ve EN): 'Villa Amara', 'Sultan', 'Cappadocia', 'Barcelona', 'Rome', 'London', 'Vienna' sorgularında API [] döndü ve liste 'Öneriler | Sonuç bulunamadı' gösterdi (EN: 'Suggestions | No results found'). Aynı terimler /api/search'te sonuç veriyor: London total=2, Rome total=2, Villa Amara total=1, Cappadocia total=1 (Kapadokya total=3). Kod: route.ts:11-24 yalnız city/country 'contains'. Yer tutucu DestinationAutocomplete.tsx:141 + messages search.autocomplete.placeholder ('City, hotel or region').

**Etki:** EN kullanıcı 'Rome' yazınca 'No results found' görüp aramayı bırakabiliyor. Otel adıyla arayan kullanıcı yanlış biçimde envanter olmadığı izlenimine kapılıyor.

**Önerilen aksiyon:** /api/locations'a mülk başlıklarını (type: 'property' olarak ayrı grupla) ve şehir eş adlarını (Cappadocia→Kapadokya, Rome→Roma, London→Londra, Vienna→Viyana, Barcelona→Barselona) ekle. Hiç eşleşme yoksa 'Sonuç bulunamadı' yerine '"{q}" için yine de ara' seçeneği sun. Yer tutucuyu gerçekte desteklenen kapsama göre güncelle.

## F514 — Hız sınırı geçersiz denemeleri de sayıyor ve itirazlarla ortak; 429 mesajı süre ve alternatif kanal vermiyor

| Alan                | Değer                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                  |
| Durum               | Gözlemlendi                                                                                             |
| Konum               | `src/app/api/notices/route.ts:19`                                                                       |
| Diğer konumlar      | `src/app/api/notices/[id]/appeals/route.ts`, `src/lib/compliance/dsa.ts`, `messages/tr/compliance.json` |
| Kullanıcılar        | misafir, ev sahibi                                                                                      |
| Prensip             | robustness · Recoverability                                                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                     |
| Renk/tema           | Hayır                                                                                                   |
| Efor                | M                                                                                                       |
| Kaynak denetçiler   | runtime:compliance                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                            |

**Kanıt:** Aynı saat içinde yapılan 2 adet 400 (doğrulama hatası) ve 3 adet 201'den sonraki 6. deneme (p10, mobile) 429 NOTICE_RATE_LIMITED aldı. UI 'Çok fazla bildirim gönderildi; lütfen daha sonra tekrar deneyin.' diyor ama ne zaman tekrar denenebileceğini belirtmiyor. Uyarı 860-900 aralığında, fold altında; RT/crops/compliance/p10-429-mobile.png'de form değişmemiş görünüyor. Kod: assertNoticeRateLimit (route.ts:19), noticeInputSchema.parse'tan (satır 20) önce çalışıyor, bu yüzden hatalı gönderimler de 5/saat kotasını tüketiyor. appeals/route.ts:21 aynı anahtarı kullanıyor, yani bildirim yapan kişi o saat içinde itiraz da edemiyor.

**Etki:** Yazım hatası yapan bir misafir birkaç denemede yasal bildirim kanalından bir saatliğine kilitleniyor. Karar e-postasındaki itiraz bağlantısı da aynı limite takılabiliyor. Mesaj bekleme süresi ya da başka bir kanal sunmadığı için kullanıcı çıkmaza giriyor.

**Önerilen aksiyon:** Şema doğrulamasını rate-limit'ten önce yapın ya da 400 yanıtlarını ayrı ve daha toleranslı bir kovada sayın. İtirazlar için ayrı bir anahtar kullanın. Retry-After başlığını döndürüp 'Yaklaşık X dakika sonra tekrar deneyin' gösterin. Alternatif bir iletişim kanalı (e-posta ya da destek bağlantısı) ekleyin. Mesajı görünür alana kaydırın.

## F515 — EN arayüzde Türkçe hata metni çıkıyor: 'İstek başarısız (502)'

| Alan                | Değer                             |
| ------------------- | --------------------------------- |
| Severity            | Medium                            |
| Durum               | Gözlemlendi                       |
| Konum               | `src/lib/api-client.ts:40`        |
| Kullanıcılar        | admin, tümü                       |
| Prensip             | accessibility · Tutarlılık ve dil |
| Sezgisel madde      | H4 — Tutarlılık/standartlar       |
| WCAG                | 3.1.2 Bölümlerin Dili (AA)        |
| Renk/tema           | Hayır                             |
| Efor                | S                                 |
| Kaynak denetçiler   | runtime:admin                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**      |

**Kanıt:** RUNTIME p7-en.mjs (EN, html lang=en): rol formu JSON olmayan 502 yanıtı aldığında #roles canlı bölgesinde 'İstek başarısız (502)' gösteriyor. Varsayılan mesaj toApiError'da sabit Türkçe.

**Etki:** İngilizce kullanan admin hatayı anlamıyor. Ekran okuyucu Türkçe metni İngilizce telaffuz ediyor.

**Önerilen aksiyon:** ApiError'a status/code taşıyın; arayüzde t('common.requestFailed', {status}) ile yerelleştirin. api-client içinde sabit Türkçe metin bırakmayın.

## F516 — EN arayüzde host işlemlerinin sunucu hata mesajları Türkçe

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                              |
| Durum               | Gözlemlendi                                                                                         |
| Konum               | `src/lib/http/errors.ts:154`                                                                        |
| Diğer konumlar      | `src/lib/host/host-service.ts`, `src/lib/pricing/promotion-service.ts`, `src/lib/vision/quality.ts` |
| Kullanıcılar        | ev sahibi                                                                                           |
| Prensip             | learnability · Learnability: tutarlılık (dil)                                                       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                         |
| WCAG                | 3.1.2 Language of Parts (AA) ile ilişkili                                                           |
| Renk/tema           | Hayır                                                                                               |
| Efor                | M                                                                                                   |
| Kaynak denetçiler   | runtime:host                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                        |

**Kanıt:** Probe p8 (EN, NEXT_LOCALE=en, mock gerçek sunucu gövdesiyle): promosyon gönderiminde Status 'Doğrulama hatası' gösterdi. Sabit Türkçe sunucu mesajları: errors.ts:154 'Doğrulama hatası', host-service.ts:310 'Tarih aralığı 1–365 gece olmalı', promotion-service.ts:43 'Kupon kodu 4–40 harf/rakam/-/_ olmalı', quality.ts:121 'Görsel okunamadı'. EN seed'de Londra, Paris ve Tokyo ilanları olan ev sahipleri bu mesajları görüyor. Hata metni lang='tr' ile işaretli değil.

**Etki:** İngilizce kullanan ev sahibi hata nedenini okuyamıyor. Ekran okuyucu Türkçe metni İngilizce telaffuzla okuyor.

**Önerilen aksiyon:** API hata gövdesindeki code ve details alanlarını istemcide i18n anahtarlarına eşleyin (errors.VALIDATION_ERROR, host.calendar.rangeInvalid …). Ya da sunucuda Accept-Language/NEXT_LOCALE'e göre mesaj üretin. Çevrilemeyen metni lang='tr' ile işaretleyin.

## F517 — YZ yorum özeti yanlış alıntılıyor ve anlamsız tema başlığı üretiyor ('temizlik' → resepsiyon cümlesi, 'Öne çıkan konu: Yaradı')

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                 |
| Durum               | Gözlemlendi                                                                            |
| Konum               | `src/lib/llm/demo.ts:80`                                                               |
| Diğer konumlar      | `src/lib/ai/review-highlights-core.ts`, `src/components/property/ReviewHighlights.tsx` |
| Kullanıcılar        | misafir                                                                                |
| Prensip             | robustness · Honesty / Predictability (Dix)                                            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                            |
| Renk/tema           | Hayır                                                                                  |
| Efor                | S                                                                                      |
| Kaynak denetçiler   | runtime:pdp                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                           |

**Kanıt:** RUNTIME p4-reviews-a11y.mjs (Grand Deluxe, demo mod): Olumlu: 'temizlik: "7/24 resepsiyon yoğun programımda çok işime yaradı." [1]' ve 'personel ve hizmet:' aynı cümle; özet 'Misafirler en çok temizlik konusunu övüyor [1]' kaynağı resepsiyon cümlesi. 'Öne çıkan temalar' kartı başlığı 'Öne çıkan konu: Yaradı'. Kod: demo.ts:80 firstSentence(hits[0].comment) eşleşen cümle yerine yorumun ilk cümlesini alıyor; review-highlights-core.ts:190-192 başlık için fiil kelimesi seçiliyor.

**Etki:** 'Her iddia birebir alıntıdır' vaadine rağmen iddia ile kanıt uyuşmuyor; kullanıcı özete güvenmez.

**Önerilen aksiyon:** Alıntı olarak tema anahtarını içeren cümleyi seçin; başlık anahtar kelimesini durdurma kelimeleri/fiiller dışından (isim) seçin ya da tema etiket sözlüğünü kullanın; eşleşme yoksa maddeyi atlayın.

## F791 — 'Passkey' ve 'Ağ: x.x.x.x' gibi teknik terimler açıklanmadan kullanılıyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `messages/tr/account.json:50`                                |
| Diğer konumlar      | `messages/en/account.json:50`, `messages/tr/account.json:94` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · familiarity                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                  |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:account                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** account.json:49-50 'Passkey'ler' ve 'Parolasız giriş ve riskli görünen ödemelerde ek doğrulama için kullanılır.' Passkey'in ne olduğu (parmak izi, yüz tanıma, ekran kilidi) anlatılmıyor. 76 'Passkey ile doğrula'. 94 'Ağ: {ip}' maskeli IP gösteriyor, ör. '85.105.12.x' (user-sessions.ts:27-32).

**Etki:** Bilgisayar okuryazarlığı düşük misafir passkey eklemenin ne işe yaradığını ve nasıl çalıştığını anlamıyor, güvenli girişi benimsemiyor. 'Ağ: 85.105.12.x' bilgisini tanıdık ya da yabancı cihaz kararında kullanamıyor.

**Önerilen aksiyon:** TR'de 'Geçiş anahtarı (passkey)' terimini kullanın. Açıklamayı 'Parmak iziniz, yüz tanıma ya da telefonunuzun ekran kilidiyle parola yazmadan giriş yapmanızı sağlar.' yapın. 'Ağ' yerine 'IP adresi (yaklaşık)' yazın ve kısa bir yardım metni ekleyin.

## F792 — Yeniden doğrulama başlığı aynı sayfadaki 'Kimlik doğrulama' (KYC) bölümüyle karışıyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Medium                                   |
| Durum               | Aday                                     |
| Konum               | `messages/tr/account.json:71`            |
| Kullanıcılar        | misafir, ev sahibi                       |
| Prensip             | learnability · consistency / familiarity |
| Sezgisel madde      | H4 — Tutarlılık/standartlar              |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | area:account                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**             |

**Kanıt:** account.json:71 `"title": "Kimliğinizi doğrulayın"`. Aynı Hesabım sayfası IdentityVerification bölümünü trust.json:22 `"title": "Kimlik doğrulama"` başlığı ve 'Kimliğinizi doğrulayarak ev sahiplerine ... güven verin' girişiyle gösteriyor (IdentityVerification.tsx:94-97, page.tsx:251).

**Etki:** 'Passkey ekle' ya da 'Oturumu kapat' diyen misafir 'Kimliğinizi doğrulayın' başlığını görünce belge yüklemesi isteneceğini sanıp işlemi bırakabilir.

**Önerilen aksiyon:** TR başlığı 'Devam etmek için parolanızı girin' ya da 'Bu işlemi onaylayın' olarak değiştirin. EN metin ('Confirm it's you') aynı kalabilir.

## F793 — Oturumlar açıklaması parola değiştirmeyi öneriyor ama parola değiştirme yolu yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `messages/tr/account.json:84`                   |
| Diğer konumlar      | `src/components/account/SessionManager.tsx:147` |
| Kullanıcılar        | tümü                                            |
| Prensip             | robustness · task conformance                   |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                      |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:account                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** account.json:84 '...oturumu kapatın ve parolanızı değiştirin.' diyor. SessionManager'da da hesap sayfasının bağlantı satırında da (page.tsx:257-269) parola bağlantısı yok. Girişli kullanıcı için parola değiştirme ucu yok, yalnızca /api/auth/password/forgot ve /reset var.

**Etki:** Tanımadığı bir cihaz gören kullanıcı önerilen güvenlik adımını nasıl atacağını bilemiyor. Ele geçirilmiş hesapta saldırgan parolayla yeniden girebiliyor.

**Önerilen aksiyon:** Açıklamaya ve 'Diğer tüm oturumları kapat' başarı mesajına 'Parolanızı değiştirin' bağlantısı ekleyin. Bağlantı /forgot-password'a e-posta önceden doldurulmuş olarak gitsin, ya da yeniden doğrulamalı bir parola değiştirme formu yapın.

## F794 — Misafire açıklanmayan alan terimleri: passkey, mandate, cashback, provizyon, DSA md. 20/21, 'Devir pazarı'

| Alan                | Değer                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                                                                                                                        |
| Konum               | `messages/tr/account.json:105`                                                                                                                                                                                                                              |
| Diğer konumlar      | `messages/tr/account.json:116`, `messages/tr/payment.json:30`, `messages/tr/wallet.json:13`, `messages/tr/resolution.json:65`, `messages/tr/compliance.json:142`, `messages/tr/compliance.json:156`, `messages/tr/nav.json:7`, `messages/tr/payouts.json:6` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                                                                          |
| Prensip             | learnability · familiarity                                                                                                                                                                                                                                  |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                       |
| Efor                | S                                                                                                                                                                                                                                                           |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                |

**Kanıt:** account.json:105 '...sınırlı bir yetki (mandate) verin', 116 'ilan kimliklerini virgülle ayırarak girin' (misafir ilan kimliği bilmez); 'Passkey' tanımsız (account.json passkeys.*, payment.json:30); wallet.json:13 '%{rate} cashback'; resolution.json:65 'yalnızca provizyon alınır'; compliance.json:142 'DSA md. 20 kapsamında', 156 'DSA md. 21 kapsamında mahkeme dışı uyuşmazlık çözümüne başvurabilirsiniz' (nasıl/nereye yok); nav.json:7 'Devir pazarı'; payouts.json:6 '...payout geçmişinizi' (TR metinde İngilizce).

**Etki:** Okuryazarlığı düşük misafir ve ev sahibi bu özellikleri yanlış anlar veya kullanmaz; itiraz reddi sonrası başvuru yolu belirsiz kalır.

**Önerilen aksiyon:** Her terimin ilk kullanımında kısa açıklama veya ⓘ ipucu (button + aria-describedby) ekleyin: 'Passkey (geçiş anahtarı): parolasız, cihaz kilidiyle giriş'; 'mandate' yerine 'ödeme yetkisi'; 'cashback' yerine 'nakit iade (kredi)'; 'provizyon (kartta geçici bloke)'; DSA reddinde başvurulabilecek kuruma bağlantı; 'Devir pazarı' yerine 'Rezervasyon devri'; 'payout' yerine 'ödeme'.

## F795 — Rol güncelleme mesajı yanlış: 'en geç 15 dk içinde yansır' diyor ama kullanıcının oturumları anında kapanıyor

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | Medium                                                                     |
| Durum               | Aday                                                                       |
| Konum               | `messages/tr/admin.json:93`                                                |
| Diğer konumlar      | `messages/en/admin.json:93`, `src/components/admin/AdminDashboard.tsx:500` |
| Kullanıcılar        | admin                                                                      |
| Prensip             | learnability · predictability                                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                |
| Renk/tema           | Hayır                                                                      |
| Efor                | S                                                                          |
| Kaynak denetçiler   | area:admin                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                               |

**Kanıt:** tr/admin.json:93 `"updated": "Rol güncellendi: {role} (en geç 15 dk içinde yansır)."`, en/admin.json:93 'takes effect within 15 minutes'. Oysa api/admin/users/[id]/role/route.ts yorumu 'tüm token'larını anında geçersizleştirir (tokenVersion++; eski rolle 15 dk yetki sızıntısı yok)' diyor ve bumpTokenVersion/publishTokenVersion çağırıyor. Hedef kullanıcı tüm cihazlarda oturumdan atılıyor. Gönderimden önce bu sonuç belirtilmiyor (roles.userIdHint yalnızca 'Kendi rolünüzü değiştiremezsiniz.').

**Etki:** Yönetici etkinin gecikeceğini sanıyor ve kullanıcıyı uyarmıyor. Kullanıcı aniden oturumdan atılınca destek talebi oluşuyor. Sistem ile anlatılan davranış birbirini tutmuyor.

**Önerilen aksiyon:** Mesajı düzeltin: 'Rol güncellendi: {role}. Kullanıcının tüm oturumları kapatıldı; yeniden giriş yaptığında yeni rol geçerli olur.' Forma gönderim öncesi bir hint ekleyin: 'Rol değişince kullanıcının tüm cihazlardaki oturumu kapanır.' {role} değerini çevrilmiş rol adıyla gösterin.

## F796 — Pay durum etiketleri gerçek dünyayla ve diller arasında uyumsuz

| Alan                | Değer                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                           |
| Durum               | Aday                                                                                                             |
| Konum               | `messages/tr/cart.json:88`                                                                                       |
| Diğer konumlar      | `messages/en/cart.json:88`, `messages/tr/cart.json:86`, `messages/tr/cart.json:111`, `messages/tr/cart.json:113` |
| Kullanıcılar        | misafir                                                                                                          |
| Prensip             | learnability · familiarity                                                                                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                      |
| Renk/tema           | Hayır                                                                                                            |
| Efor                | S                                                                                                                |
| Kaynak denetçiler   | area:cart                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                     |

**Kanıt:** tr:88 `"AUTHORIZED": "Ödendi (onay bekliyor)"`, en:88 `"Paid (awaiting others)"`: iki dil farklı anlam veriyor. Aynı durum için katılımcıya "... kartınızdan tahsil edilecek" (tr:113) deniyor; 'Ödendi' ile çelişiyor. tr:86 `"INVITED": "Bekliyor"` kimin neyi beklediğini söylemiyor. tr:111 `"cartTotal": "Toplam rezervasyon"` ('rezervasyon toplamı' yerine belirsiz).

**Etki:** Organizatör ve katılımcı paranın çekilip çekilmediğini yanlış yorumlar; TR ve EN kullanıcılar farklı anlam okur.

**Önerilen aksiyon:** AUTHORIZED → 'Onaylandı, tahsilat bekliyor' / 'Authorized — charged when all shares are in'; INVITED → 'Ödeme bekleniyor' / 'Awaiting payment'; cartTotal → 'Rezervasyon toplamı'.

## F797 — Ödeme/rezervasyon durum sözlüğü ekranlar arasında tutarsız; yetkilendirilmiş pay 'Ödendi' olarak gösteriliyor

| Alan                | Değer                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                         |
| Durum               | Aday                                                                                                                                                                                           |
| Konum               | `messages/tr/cart.json:88`                                                                                                                                                                     |
| Diğer konumlar      | `messages/tr/cart.json:89`, `messages/tr/payment.json:54`, `messages/tr/resolution.json:68-70`, `messages/en/cart.json:88-89`, `messages/tr/host.json:30-37`, `messages/tr/account.json:20-24` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                             |
| Prensip             | learnability · consistency                                                                                                                                                                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                          |
| Efor                | M                                                                                                                                                                                              |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                   |

**Kanıt:** cart.json:88 AUTHORIZED 'Ödendi (onay bekliyor)' / EN 'Paid (awaiting others)' — oysa share.authorized 'Tüm paylar ödenince ... kartınızdan tahsil edilecek' der (para henüz çekilmedi, TR 'onay bekliyor' ≠ EN 'awaiting others'). CAPTURED: cart.json:89 'Tahsil edildi'/EN 'Captured', payment.json:54 'Tahsil edildi'/EN 'Charged', resolution deposit 'Captured'. Rezervasyon durumu: account.json 'Beklemede/İptal Edildi', booking.json 'Rezervasyon iptal edildi', host.json bookingStatus 'Tutuldu/İptal'.

**Etki:** Misafir payının çekildiğini sanır (iade beklentisi/şikâyet); aynı durum farklı ekranlarda farklı adla göründüğü için sistem modeli öğrenilemez.

**Önerilen aksiyon:** Tek bir durum sözlüğü (status.booking._, status.payment._) oluşturup tüm ekranlarda kullanın; AUTHORIZED için 'Kartınızda ayrıldı — henüz çekilmedi' / 'Reserved on your card — not charged yet'; EN'de 'Charged' tek terim olsun.

## F798 — Çerez tercihini değiştirmek için kullanıcıdan çerezi elle silmesi isteniyor

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                     |
| Durum               | Aday                                                                                       |
| Konum               | `messages/tr/privacy.json:34`                                                              |
| Diğer konumlar      | `src/components/privacy/CookieConsent.tsx:30-34`, `src/components/layout/Footer.tsx:72-77` |
| Kullanıcılar        | tümü                                                                                       |
| Prensip             | flexibility · customizability (kullanıcı kontrolü)                                         |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                          |
| Renk/tema           | Hayır                                                                                      |
| Efor                | S                                                                                          |
| Kaynak denetçiler   | lens:copy                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                               |

**Kanıt:** privacy.json:34 '...Tercihiniz <code>cookie_consent</code> çerezinde saklanır; çerezi silerek tercihinizi değiştirebilirsiniz.' CookieConsent.tsx:30-34 çerez varsa bandı hiç göstermez ve yeniden açma API'si yok; Footer.tsx:72-77 'Çerez Bildirimi' yalnız /privacy#p-cookies metnine gider.

**Etki:** Onayını geri çekmek isteyen kullanıcı tarayıcı ayarlarında çerez silmek zorunda kalır (KVKK/GDPR'de rıza geri çekme verme kadar kolay olmalı); teknik terim 'cookie_consent' gösterilir.

**Önerilen aksiyon:** Footer'a 'Çerez tercihleri' düğmesi ekleyip CookieConsent'i customizing modunda yeniden açın (paylaşılan store ile); privacy.json metnini 'Tercihinizi sayfa altındaki Çerez tercihleri bağlantısından istediğiniz zaman değiştirebilirsiniz' olarak güncelleyin.

## F799 — Aynı kavram için farklı adlar: Mülk / İlan / Tesis / Konaklama / 'Property'; değerlendirme / yorum

| Alan                | Değer                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                              |
| Durum               | Aday                                                                                                                                                |
| Konum               | `messages/tr/property.json:3`                                                                                                                       |
| Diğer konumlar      | `messages/tr/host.json:3`, `messages/tr/trust.json:66`, `messages/tr/property.json:4`, `messages/tr/search.json:106`, `messages/tr/compare.json:22` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                  |
| Prensip             | learnability · consistency                                                                                                                          |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                         |
| Renk/tema           | Hayır                                                                                                                                               |
| Efor                | S                                                                                                                                                   |
| Kaynak denetçiler   | lens:copy                                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                        |

**Kanıt:** property.json:3 'Property Bulunamadı' (TR metinde İngilizce kelime); host.json page.intro 'Mülklerinizi', bookings.columns.property 'Mülk', promotions.allListings 'Tüm ilanlarım', trust.json partyRisk.columns.property 'İlan', compliance host intro 'Tesisinizin ... ilan fotoğraflarınızdan', resolution host.listingWide 'İlan geneli', checkout.json stay 'Konaklama'. Puan sayısı: property.json:4 ve search.json:106 '{count} değerlendirme', compare.json:22 '({count} yorum)', reviews başlığı 'Misafir yorumları'.

**Etki:** Ev sahibi 'mülk' ile 'ilan'ın farklı şeyler olup olmadığını sorgular; misafir 'değerlendirme' ile 'yorum' sayısının aynı olduğunu çıkaramaz (sentezlenebilirlik düşer).

**Önerilen aksiyon:** Sözlük belirleyin: arayüzde 'İlan' (listing) ve misafir için 'Konaklama yeri'; 'Mülk' ve 'Tesis'i kaldırın; property.json:3'ü 'İlan bulunamadı' yapın; puan sayısı için tek terim ('{count} yorum') kullanın.

## F800 — Süreç durumu ve sıradaki adım belirsiz; giriş metni gerçek akışla çelişiyor

| Alan                | Değer                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                     |
| Durum               | Aday                                                                                                                                       |
| Konum               | `messages/tr/resolution.json:8`                                                                                                            |
| Diğer konumlar      | `messages/en/resolution.json:8,30-32`, `src/components/resolution/shared.tsx:171-180`, `src/components/resolution/ClaimDetail.tsx:136-140` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                         |
| Prensip             | robustness · observability / predictability                                                                                                |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                      |
| Efor                | M                                                                                                                                          |
| Kaynak denetçiler   | area:resolution                                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                               |

**Kanıt:** json:8 "Anlaşamazsanız talep yöneticiye aktarılır." Oysa sunucuda (claims.ts:45-47, 362-366) karşı taraf yanıt verince talep OPEN olup HER durumda yönetici kararını bekliyor. Uzlaşma ya da kabul mekanizması yok, eskalasyon yalnızca yanıtsızlıkta oluyor. Durum etiketleri json:30-32 "Açık" ve "Yöneticiye aktarıldı" ikisi de yönetici kararı beklerken farklı anlam veriyor. Rozetin (shared.tsx:171-180, ClaimDetail.tsx:138) yanında açıklama ya da süreç adımı yok.

**Etki:** "Açık" rozetini gören misafir ya da ev sahibi bir şey yapması gerekip gerekmediğini ve kararın ne zaman geleceğini bilmiyor. Uzlaşma seçeneği arıyor ama bulamıyor.

**Önerilen aksiyon:** Rozetin yanına durum ve role göre bir satırlık açıklama eklenmeli (`statusHelp.{STATUS}.{role}`). Örnek: OPEN -> "Karşı taraf yanıt verdi; talep yönetici incelemesinde." Detayın üstüne 4 adımlı sıralı liste (`<ol>`: Açıldı -> Yanıt -> Yönetici incelemesi -> Karar) konmalı, geçerli adımda `aria-current="step"` olmalı. Giriş metni şöyle yazılmalı: "Talep açıldığında karşı tarafa 72 saat yanıt süresi verilir; ardından talep yönetici tarafından karara bağlanır."

## F801 — Rol adları hukuki jargon ("Talebi açan / Yanıtlayan taraf", "Claimant/Respondent"); Misafir/Ev sahibi yok

| Alan                | Değer                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                    |
| Durum               | Aday                                                                                                                                                                                                                                      |
| Konum               | `messages/tr/resolution.json:38`                                                                                                                                                                                                          |
| Diğer konumlar      | `src/components/resolution/ClaimMessages.tsx:86`, `src/components/resolution/ClaimEvidence.tsx:63,91`, `src/components/resolution/ClaimDetail.tsx:120`, `src/components/resolution/ClaimList.tsx:48`, `messages/en/resolution.json:38-43` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                      |
| Prensip             | learnability · familiarity / gerçek dünya eşleşmesi                                                                                                                                                                                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                                                     |
| Efor                | S                                                                                                                                                                                                                                         |
| Kaynak denetçiler   | area:resolution                                                                                                                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                              |

**Kanıt:** json:38-43 `"OPENER": "Talebi açan", "RESPONDENT": "Yanıtlayan taraf"` (EN "Claimant"/"Respondent"). Bu etiketler ClaimMessages.tsx:86 `t(`role.${m.role}`)`, ClaimEvidence.tsx:63, ClaimDetail.tsx:120 ve ClaimList.tsx:48'de doğrudan kullanılıyor. Talep türü (GUEST_REFUND/HOST_DAMAGE) zaten hangi tarafın misafir olduğunu belirliyor ama arayüze yansımıyor.

**Etki:** Misafir yazışmada "Yanıtlayan taraf"ın ev sahibi olduğunu çıkarmak zorunda kalıyor. Yönetici yüzlerce talepte her seferinde türden rolü zihinde eşliyor, bu da hata olasılığını artırıyor.

**Önerilen aksiyon:** Türe göre taraf etiketi türeten bir `partyLabel(type, role)` yardımcı fonksiyonu eklenmeli: GUEST_REFUND için OPENER→"Misafir", RESPONDENT→"Ev sahibi"; HOST_DAMAGE için tersi. `party.GUEST` ve `party.HOST` i18n anahtarları eklenmeli. Kullanıcının kendi rolü "Misafir (siz)" biçiminde gösterilmeli.

## F802 — Hata metinleri çıkış yolu sunmuyor ya da yanlış bilgi veriyor (e-posta doğrulama, destek, "bitmeden")

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                |
| Durum               | Aday                                                                                  |
| Konum               | `messages/tr/resolution.json:181`                                                     |
| Diğer konumlar      | `src/components/resolution/shared.tsx:122-139`, `messages/en/resolution.json:167-181` |
| Kullanıcılar        | misafir, ev sahibi                                                                    |
| Prensip             | robustness · recoverability                                                           |
| Sezgisel madde      | H9 — Hata mesajları                                                                   |
| WCAG                | 3.3.3                                                                                 |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | area:resolution                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                          |

**Kanıt:** json:181 "Bu işlem için önce e-posta adresinizi doğrulamanız gerekir." (POST /api/claims requireVerifiedEmail, route.ts:20): /verify-email sayfası var ama bağlantı yok. json:173 "…lütfen destek ekibiyle inceleyin": /support sayfası var, bağlantı yok. json:169 CLAIM_ALREADY_OPEN mevcut talebe bağlantı vermiyor. json:167 "(konaklama başlamadan / bitmeden önce)" diyor, oysa sunucu yalnız girişi kontrol ediyor (claims.ts:234-235). useClaimErrorText (shared.tsx:122-139) yalnız düz metin döndürüyor.

**Etki:** E-postası doğrulanmamış misafir talebini açamıyor ve doğrulama ekranına nasıl gideceğini bilmiyor. CLAIM_TOO_EARLY metni, çıkıştan sonra mı açılabileceği konusunda yanlış beklenti yaratıyor.

**Önerilen aksiyon:** useClaimErrorText `{ text, action?: { href, label } }` döndürmeli ve Status'un yanında Link render edilmeli: EMAIL_NOT_VERIFIED için `/verify-email` "E-postamı doğrula", REFUND_IN_PROGRESS için `/support` "Destekle iletişime geç", ALREADY_OPEN için mevcut talebe gidiş. TOO_EARLY metni "Talep, konaklamanız başladıktan ({checkIn}) sonra açılabilir." olarak düzeltilmeli.

## F1049 — EN metinde 'Sign In' / 'Sign Up' kolay karışıyor; büyük harf nav ile tutarsız, 'Forgot password' soru işaretsiz

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Low                                                                            |
| Durum               | Doğrulandı                                                                     |
| Konum               | `messages/en/auth.json:16`                                                     |
| Diğer konumlar      | `messages/en/auth.json:7`, `messages/en/auth.json:9`, `messages/en/nav.json:5` |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | learnability · familiarity, consistency                                        |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                    |
| Renk/tema           | Hayır                                                                          |
| Efor                | S                                                                              |
| Kaynak denetçiler   | area:auth                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                   |

**Kanıt:** en/auth.json:7,10 'Sign In' ile :16,19,25 'Sign Up' aynı kartta tek kelimeyle ayrışıyor; :9 'Forgot password' soru işaretsiz; nav.json:4-5 'Sign in' / 'Sign up' küçük harfli.

**Etki:** İngilizceyi ikinci dil olarak kullanan misafir iki eylemi hızlı bakışta karıştırıp yanlış forma gidebilir; büyük harf farkı tutarsız görünür.

**Önerilen aksiyon:** Kayıt eylemini 'Create account' yapın (register.title, register.submit, login.registerLink, nav.register); login.forgotPassword'u 'Forgot password?' yapın; büyük harfi cümle düzenine ('Sign in') eşitleyin.

## F1050 — 'Bağlantı 30 dakika geçerlidir' metni yapılandırılabilir süreden bağımsız sabit

| Alan                | Değer                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                   |
| Durum               | Doğrulandı                                                                                            |
| Konum               | `messages/tr/auth.json:35`                                                                            |
| Diğer konumlar      | `messages/en/auth.json:35`, `src/app/forgot-password/page.tsx:47`, `src/lib/config/app-config.ts:362` |
| Kullanıcılar        | tümü                                                                                                  |
| Prensip             | learnability · predictability                                                                         |
| Sezgisel madde      | H13 — Feedforward                                                                                     |
| Renk/tema           | Hayır                                                                                                 |
| Efor                | S                                                                                                     |
| Kaynak denetçiler   | area:auth                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                          |

**Kanıt:** auth.json:35 ve en/auth.json:35 '30 dakika' sabit; app-config.ts:362 `AUTH_RESET_TOKEN_TTL_MINUTES: int(30, 5, 24 * 60)` ile değiştirilebiliyor. E-posta tarafı auth-notifications.ts:47 `ttlLabel(locale, "minutes", config.AUTH_RESET_TOKEN_TTL_MINUTES)` ile doğru süreyi yazıyor; yalnız UI metni sabit.

**Etki:** Süre değiştirildiğinde ekran ile e-posta farklı süre söyler; kullanıcı ekrandaki süreye güvenip geç tıklarsa 'geçersiz' hatası alır.

**Önerilen aksiyon:** forgot API 202 yanıtına `validForMinutes` ekleyip forgot-password/page.tsx:47'de `t("forgot.sent", { minutes })` kullanın; daha basit alternatif olarak metinden süreyi çıkarıp 'Geçerlilik süresi e-postada yazar' deyin.

## F1051 — Aynı sayfa/kavram için tutarsız adlar, yazım ve büyük harf kullanımı

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                    |
| Durum               | Doğrulandı                                                                             |
| Konum               | `messages/tr/cookie.json:3`                                                            |
| Diğer konumlar      | `messages/tr/footer.json:30`, `messages/en/footer.json:7`, `messages/en/cookie.json:7` |
| Kullanıcılar        | tümü                                                                                   |
| Prensip             | learnability · consistency                                                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                            |
| Renk/tema           | Hayır                                                                                  |
| Efor                | S                                                                                      |
| Kaynak denetçiler   | area:shell                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                           |

**Kanıt:** cookie.json:3 '<link>aydınlatma metni</link>' ve footer.json:30 'Gizlilik Bildirimi' aynı /privacy sayfası; footer.json 'privacy': 'Gizlilik ve KVKK' kullanılmıyor. Aynı satırda 'Gizlilik Bildirimi / Kullanım Koşulları / Çerez Bildirimi' (her kelime büyük) ile 'Güven merkezi / Verilerim'. EN: 'Help Centre', 'Partner programme' (İngiliz) ile 'Trust center', 'Customize' (Amerikan).

**Etki:** Kullanıcı 'aydınlatma metni' ile 'Gizlilik Bildirimi'nin aynı belge olduğunu çıkarmak zorunda; özensiz metin güveni azaltır.

**Önerilen aksiyon:** Tek terim seçin: cookie.json body bağlantı metnini 'Gizlilik Bildirimi (KVKK aydınlatma metni)' yapın; footer.json'da cümle düzeni ('Gizlilik bildirimi', 'Kullanım koşulları', 'Çerez bildirimi') uygulayın; EN'de tek yazım (US: 'Help center', 'Partner program', 'City-center'); kullanılmayan 'privacy' anahtarını kaldırın.

## F1052 — Menü adı ile sayfa başlığı farklı ('Devir pazarı' ve 'Rezervasyon devri')

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                      |
| Durum               | Doğrulandı                                                                               |
| Konum               | `messages/tr/nav.json:7`                                                                 |
| Diğer konumlar      | `messages/tr/transfers.json:3`, `messages/en/nav.json:7`, `messages/en/transfers.json:3` |
| Kullanıcılar        | misafir                                                                                  |
| Prensip             | learnability · consistency                                                               |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                              |
| Renk/tema           | Hayır                                                                                    |
| Efor                | S                                                                                        |
| Kaynak denetçiler   | area:misc                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                             |

**Kanıt:** tr/nav.json:7 'Devir pazarı' ↔ tr/transfers.json:3 h1 'Rezervasyon devri'; en/nav.json:7 'Transfer market' ↔ en/transfers.json:3 'Booking transfer'. nav 'Gezi planla' ↔ plan.json:2 'Gezi planlayıcı'.

**Etki:** Menüden gelen kullanıcı doğru sayfada olduğunu teyit etmekte zorlanır ve aynı işlev için iki farklı ad öğrenmek zorunda kalır.

**Önerilen aksiyon:** Nav etiketini ve h1'i aynı ifadeye eşitleyin: TR nav.transfers ve transfers.page.title 'Rezervasyon devri', EN 'Booking transfers'. 'Pazar' kavramını gerekiyorsa intro metninde açıklayın.

## F1053 — 'Seyahatlerim (çevrimdışı)' ve 'Rezervasyonlarım' farkı anlatılmıyor

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Low                                                       |
| Durum               | Doğrulandı                                                |
| Konum               | `messages/tr/pwa.json:25`                                 |
| Diğer konumlar      | `messages/en/pwa.json:25`, `src/app/account/page.tsx:262` |
| Kullanıcılar        | misafir                                                   |
| Prensip             | learnability · consistency                                |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                               |
| Renk/tema           | Hayır                                                     |
| Efor                | S                                                         |
| Kaynak denetçiler   | area:account                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** pwa.json:25 accountLink 'Seyahatlerim (çevrimdışı)'; account.json:27 'Rezervasyonlarım'; account/page.tsx:262-264. Seyahatlerim'in yalnız yaklaşan onaylı rezervasyonları ve QR kartını gösterdiği hiçbir yerde söylenmiyor; '(çevrimdışı)' sayfanın yalnız çevrimdışıyken çalıştığı izlenimini veriyor.

**Etki:** Misafir QR kartını nerede bulacağını öğrenmek için iki listeyi de açmak zorunda.

**Önerilen aksiyon:** pwa.json accountLink → 'Seyahatlerim ve QR kartı (çevrimdışı da açılır)' / en 'My trips & QR card (works offline)'; account sayfasındaki Rezervasyonlarım kartı girişine 'Yaklaşan konaklamalarınızın QR kartı Seyahatlerim'de' cümlesini ekleyin.

## F1054 — Sunucu jargonu ('VAPID anahtarları') misafire gösteriliyor

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | Low                                                                |
| Durum               | Doğrulandı                                                         |
| Konum               | `messages/tr/pwa.json:34`                                          |
| Diğer konumlar      | `messages/en/pwa.json:34`, `src/components/pwa/PushToggle.tsx:113` |
| Kullanıcılar        | misafir                                                            |
| Prensip             | learnability · familiarity                                         |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                        |
| Renk/tema           | Hayır                                                              |
| Efor                | S                                                                  |
| Kaynak denetçiler   | area:trips                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                       |

**Kanıt:** pwa.json:34 'Anlık bildirimler bu sunucuda yapılandırılmamış (VAPID anahtarları yok); e-posta bildirimleri çalışmaya devam eder.'; PushToggle.tsx:22 ve 113 'view === "server-off"' iken gösteriliyor. en/pwa.json:34 aynı.

**Etki:** Misafir anlamadığı ve üzerinde hiçbir şey yapamayacağı teknik bilgi görür.

**Önerilen aksiyon:** tr: 'Anlık bildirimler şu anda kullanılamıyor; e-posta bildirimleri çalışmaya devam ediyor.' en: 'Push notifications are currently unavailable; email notifications keep working.' Teknik nedeni yalnız admin LLM/sistem durum kartında gösterin.

## F1055 — Çevrimdışı sayfa 'Seyahatlerim her zaman açılır' beklentisi veriyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Low                                                                          |
| Durum               | Doğrulandı                                                                   |
| Konum               | `messages/tr/pwa.json:41`                                                    |
| Diğer konumlar      | `messages/en/pwa.json:41`, `public/sw.js:133`, `src/app/offline/page.tsx:14` |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | learnability · predictability                                                |
| Sezgisel madde      | H13 — Feedforward                                                            |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | area:shell                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                 |

**Kanıt:** pwa.json:41 'Seyahatlerim sayfası ve rezervasyon QR kartınız çevrimdışı da açılır.'; sw.js:22 OFFLINE_PAGES yalnız çalışma anında önbelleğe alınır, PRECACHE (21) yalnız /offline içerir; 133 'networkFirst(...).catch(offlineFallback)' → /trips daha önce açılmadıysa offline/page.tsx:14 bağlantısı kullanıcıyı aynı çevrimdışı sayfaya döndürür. Oysa pwa.json:9 trips.intro koşulu doğru anlatıyor.

**Etki:** Seyahatlerim'e tıklayan misafir aynı sayfayı tekrar görür, döngüde kalır ve neden QR kartına ulaşamadığını anlamaz.

**Önerilen aksiyon:** tr: 'Bu sayfa çevrimdışı kullanılamıyor. Seyahatlerim sayfasını daha önce internete bağlıyken açtıysanız QR kartınız burada da görünür.'; en karşılığını aynı biçimde düzeltin.

## F1056 — Çevrimdışı sayfasının dili ve açık teması SW kurulum anında donuyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Low                                                   |
| Durum               | Doğrulandı                                            |
| Konum               | `public/sw.js:21`                                     |
| Diğer konumlar      | `src/app/layout.tsx:34`, `src/app/offline/page.tsx:6` |
| Kullanıcılar        | misafir                                               |
| Prensip             | robustness · consistency                              |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                           |
| WCAG                | 3.1.1                                                 |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | area:shell                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** sw.js:15 `VERSION = 'v1'`, :21 PRECACHE /offline'ı install'da bir kez önbelleğe alıyor ve :105 `caches.match(OFFLINE_URL)` ile sunuyor; /offline başka bir yerde yenilenmiyor. offline/page.tsx getTranslations('pwa') ile sunucu tarafında, layout.tsx:34,40 kurulum anındaki locale ve data-theme çereziyle render ediliyor.

**Etki:** Türkçe kurulup sonra İngilizceye geçen kullanıcı çevrimdışı sayfayı Türkçe (lang='tr') ve, açık tema seçtiyse, eski temada görür.

**Önerilen aksiyon:** LocaleSwitcher ve ThemeToggle değişiminden sonra `navigator.serviceWorker.controller?.postMessage({ type: 'REFRESH_OFFLINE' })` gönderin; sw.js'te bu mesajda `caches.open(STATIC_CACHE).then(c => c.add(OFFLINE_URL))` ile sayfayı yeniden önbelleğe alın (mevcut CLEAR_USER_DATA mesaj deseniyle aynı).

## F1057 — Redis kesintisi kullanıcıya 'bu hesap için çok fazla deneme' olarak bildiriliyor

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Doğrulandı                    |
| Konum               | `src/lib/auth/account.ts:128` |
| Diğer konumlar      | `src/app/login/page.tsx:61`   |
| Kullanıcılar        | tümü                          |
| Prensip             | robustness · observability    |
| Sezgisel madde      | H9 — Hata mesajları           |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:auth                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** account.ts:116-129 Redis mget/incr hata verirse `catch { throw new LoginRateLimitedError(); }` → :44-50 429 'Bu hesap için çok fazla deneme…'; login/page.tsx:61 `data.error`'u olduğu gibi gösteriyor.

**Etki:** Altyapı kesintisinde ilk kez giriş deneyen kullanıcı hesabına saldırı yapılıyor ya da kendisi hata yapmış gibi bir mesaj görür; gereksiz şifre sıfırlama denemesine yönelir.

**Önerilen aksiyon:** Güvenlik için kapalı-başarısız (fail-closed) davranışı koruyun ama Redis hatasında ayrı bir hata fırlatın: 503 `SERVICE_UNAVAILABLE` (zaten isDependencyUnavailable deseni var) ve istemcide çevrili 'Giriş şu an geçici olarak yapılamıyor, birkaç dakika sonra tekrar deneyin' metni.

## F1058 — Yalnız son 200 mesaj geliyor; daha eski mesaj olduğu belirtilmiyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Low                                        |
| Durum               | Doğrulandı                                 |
| Konum               | `src/lib/messaging/message-service.ts:108` |
| Diğer konumlar      | `src/lib/config/app-config.ts:301`         |
| Kullanıcılar        | misafir, ev sahibi                         |
| Prensip             | robustness · observability                 |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü             |
| Renk/tema           | Hayır                                      |
| Efor                | M                                          |
| Kaynak denetçiler   | area:trips                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** message-service.ts:106-108 `orderBy: { createdAt: 'desc' }, take: getConfig().MESSAGE_PAGE_SIZE` (app-config.ts:301 varsayılan 200); yanıtta hasMore yok, istemcide 'daha eski' kontrolü yok.

**Etki:** 200'ü aşan nadir uzun yazışmalarda ilk talimat mesajları sessizce kaybolur, kullanıcı tüm geçmişi gördüğünü sanır.

**Önerilen aksiyon:** listMessages'ta `take: size + 1` ile `hasMore` hesaplayıp `before` imleci kabul edin; BookingMessages listesinin başında `Button` 'Daha eski mesajları yükle' gösterin.

## F1080 — Tutar ipucu jargon içeriyor: 'Ana para birimi cinsinden' / 'In major units'

| Alan                | Değer                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                    |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                                                                        |
| Konum               | `messages/tr/resolution.json:89`                                                                                                                                       |
| Diğer konumlar      | `messages/en/resolution.json`, `src/components/resolution/OpenClaimForm.tsx`, `messages/en/resolution.json:88-89`, `src/components/resolution/OpenClaimForm.tsx:69-77` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                     |
| Prensip             | learnability · Gerçek dünya eşleşmesi                                                                                                                                  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                                  |
| Efor                | S                                                                                                                                                                      |
| Kaynak denetçiler   | runtime:resolution, area:resolution                                                                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                           |

**Kanıt:** RUNTIME p1-panel/p2-completed: tutar alanının aria-describedby metni TR'de "Ana para birimi cinsinden, örneğin 250,00.", EN'de "In major units, for example 250.00." Etiket yalnızca "Tutar (TRY)". Para birimi sembolü (₺) ve kuruşun nasıl yazılacağı ayrıca açıklanmıyor.

**Etki:** Okuryazarlık düzeyi düşük misafir 'ana para birimi' ifadesini anlamayabiliyor ve kuruş cinsinden yazmaya çalışabiliyor.

**Önerilen aksiyon:** Etiket "Talep ettiğiniz tutar (₺)" olsun, ipucu "Türk lirası olarak yazın, örneğin 250 veya 250,50". Alanın soluna ₺ öneki ekleyin ve binlik ayırıcı bulgusundaki canlı önizlemeyle birleştirin.

## F1111 — EN yerelinde tarih esnekliğinde çoğul hatası: "±1 days"

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Gözlemlendi                               |
| Konum               | `messages/en/search.json:130`             |
| Kullanıcılar        | misafir                                   |
| Prensip             | learnability · Tutarlılık ve dil kalitesi |
| Sezgisel madde      | H4 — Tutarlılık/standartlar               |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | runtime:results                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** RUNTIME 118-anon-en-desktop gövde metni: "Exact dates ±1 days ±2 days ±3 days".

**Etki:** Küçük bir dil hatası; özen eksikliği izlenimi veriyor.

**Önerilen aksiyon:** "plusMinus": "±{days, plural, one {# day} other {# days}}" kullanın.

## F1112 — Tutma bitiş saatinde Türkçe ek sabit kodlanmış ve çoğu saatte yanlış ('00:22'e', '00:16'e')

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Gözlemlendi                                 |
| Konum               | `messages/tr/cart.json:41`                  |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · Gerçek dünya eşleşmesi (dil) |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                 |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | runtime:cart                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** p4-hold, desktop TR: 'Tüm odalar 00:22'e kadar sizin için tutuluyor.' (doğrusu 00:22'ye). p10: '00:16'e' (doğrusu 00:16'ya) ve '00:17'e' (doğrusu 00:17'ye). Şablon: "heldUntil": "Tüm odalar {time}'e kadar sizin için tutuluyor." Ekran görüntüsü: crops/cart/p4d-0.png

**Etki:** Dil hatası güveni zedeliyor; özenli metin bekleyen ödeme adımında dikkat çekiyor.

**Önerilen aksiyon:** Ekten kaçın: 'Tüm odalar sizin için tutuluyor — bitiş: {time}' ya da 'Tutma bitişi: {time}'. Bu, kalan süre geri sayımıyla birleştirilebilir.

## F1113 — 'Onay e-postası gönderildi' denmesine rağmen e-posta yalnızca kuyruğa alınmış

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Low                                                         |
| Durum               | Gözlemlendi                                                 |
| Konum               | `messages/tr/compliance.json:23`                            |
| Diğer konumlar      | `src/lib/compliance/dsa.ts`, `messages/en/compliance.json`  |
| Kullanıcılar        | misafir, ev sahibi                                          |
| Prensip             | robustness · Observability: durum bildirimleri doğru olmalı |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                              |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | runtime:compliance                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** 3 başarılı gönderimden sonra DB'de salt okunur sorgu yapıldı: OutboxMessage 'compliance.notice_received' kayıtları status=PENDING, attempts=0; Notification tablosunda hci-probe@example.com için kayıt yok (bu ortamda worker çalışmıyor). UI ise API 201 döndüğü anda geçmiş zamanla 'Onay e-postası gönderildi' diyor. E-posta outbox üzerinden asenkron gönderiliyor (dsa.ts ~109).

**Etki:** E-posta gecikirse ya da gönderilemezse kullanıcı yanlış bir güvenceye dayanarak bekliyor. Yasal kanalda güvenilirlik algısı zarar görüyor.

**Önerilen aksiyon:** Metni 'Onay e-postası birkaç dakika içinde gönderilecek; gelmezse istenmeyen posta klasörünü kontrol edin.' olarak değiştirin. EN için de 'will be sent shortly' kullanın.

## F1114 — Tutma metninde Türkçe ek uyumu yanlış ('00:20'e', '00:30'e')

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Gözlemlendi                                  |
| Konum               | `messages/tr/payment.json:9`                 |
| Kullanıcılar        | misafir                                      |
| Prensip             | learnability · Familiarity: dil doğal olmalı |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                  |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | runtime:checkout                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** RUNTIME p2: 'Oda sizin için 00:20'e kadar tutuluyor.'; p2c mobil: '00:22'e'; p11: '00:30'e'. Doğrusu sırasıyla '00:20'ye', '00:22'ye', '00:30'a'. Şablon sabit ''e' eki kullanıyor (payment.json:9).

**Etki:** Küçük ama güven zedeleyen bir dil hatası, ödeme ekranının en kritik satırında.

**Önerilen aksiyon:** Ek gerektirmeyen bir yapı kullanılsın: 'Oda sizin için saat {time} itibarıyla serbest kalacak' ya da 'Kalan süre: {min} dk (saat {time})'.

## F1115 — Sıralama açıklamaları teknik jargonla yazılmış; satırlar ağırlığa göre sıralı değil

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Gözlemlendi                   |
| Konum               | `messages/tr/ranking.json:18` |
| Diğer konumlar      | `src/app/ranking/page.tsx`    |
| Kullanıcılar        | misafir                       |
| Prensip             | learnability · Familiarity    |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi   |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | runtime:compliance            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** Sweep 026/027 tablosu: 'Bayes düzeltmeli ortalama puan', 'yorum sayısının logaritmik ölçeği', 'Arama metni benzerliği'. Satır sırası %30, %35, %10, %10, %15; en yüksek ağırlık ikinci sırada (RT/crops/compliance/027-anon-tr-mobile-_ranking-0.png).

**Etki:** Geniş okuryazarlık yelpazesindeki misafir, DSA'nın 'anlaşılır dil' beklentisine rağmen sıralama mantığını kavrayamıyor.

**Önerilen aksiyon:** Sade dil kullanın: 'Az yorumu olan ilanın puanı tek bir yüksek puanla şişmesin diye genel ortalamaya doğru dengelenir'; 'Yorum sayısı arttıkça etkisi azalarak artar'. Satırları ağırlığa göre azalan sırada gösterin ve basit oran çubukları ekleyin.

## F1116 — Bildirim giriş noktalarında terim ve kural tutarsızlığı (Bildir / Şikâyet et / Yasa dışı içerik bildir)

| Alan                | Değer                                                         |
| ------------------- | ------------------------------------------------------------- |
| Severity            | Low                                                           |
| Durum               | Gözlemlendi                                                   |
| Konum               | `messages/tr/reviews.json:31`                                 |
| Diğer konumlar      | `messages/tr/compliance.json`, `messages/tr/trustCenter.json` |
| Kullanıcılar        | misafir                                                       |
| Prensip             | learnability · Consistency                                    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                   |
| Renk/tema           | Hayır                                                         |
| Efor                | M                                                             |
| Kaynak denetçiler   | runtime:compliance                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                  |

**Kanıt:** Gözlenen etiketler: ilan sayfasında 'Bu ilanı bildir'; güven merkezinde 'Yasa dışı içerik bildir (DSA)'; sayfa H1'i 'İçerik bildir'; yorum kartında 'Şikâyet et' ve 'Gönder'. Yorum nedenleri (Saldırgan, Spam, Sahte, Kişisel bilgi) bildirim kategorilerinden farklı. Yorum şikâyeti giriş istiyor (p11), ilan bildirimi anonim yapılabiliyor (p3).

**Etki:** Kullanıcı hangi yolun ne zaman kullanılacağını öğrenemiyor (genellenebilirlik düşük). Yorumdaki yasa dışı içerik DSA kanalına ulaşmıyor.

**Önerilen aksiyon:** Tek bir fiil kullanın: 'Bildir'. Yorumlar için de aynı bildirim akışını (anonim ve kategorili) ya da en azından aynı terimleri kullanın. Güven merkezindeki bağlantıyı H1 ile eşleyin.

## F1117 — TR'de değerlendirme sayısı binlik ayraçsız ('1820 değerlendirme'), EN'de '1,820 reviews'

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Gözlemlendi                               |
| Konum               | `messages/tr/search.json:106`             |
| Kullanıcılar        | misafir                                   |
| Prensip             | learnability · Learnability / consistency |
| Sezgisel madde      | H4 — Tutarlılık/standartlar               |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | runtime:home                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** RUNTIME tarama 000 bodyTextSample: '1820 değerlendirme'. 116 (EN): '1,820 reviews'. Ekran görüntüsü C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/home/000-anon-tr-desktop-_-1.png. Intl.NumberFormat('tr').format(1820) = '1.820'. Kod: tr 'reviews': '{count} değerlendirme' (ICU # biçimleme yok). en: '{count, plural, … # reviews}'.

**Etki:** Sayı biçimi yerel beklentiyle ve diğer fiyat alanlarıyla ('₺3.200,00') tutarsız.

**Önerilen aksiyon:** '{count, plural, other {# değerlendirme}}' kullan veya '{count, number}' ile biçimle.

## F1118 — Scorecard notu güncel değil: depo 'özel' deniyor ama depo herkese açık

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Gözlemlendi                                      |
| Konum               | `messages/tr/trustCenter.json:11`                |
| Diğer konumlar      | `messages/en/trustCenter.json`                   |
| Kullanıcılar        | tümü                                             |
| Prensip             | robustness · Observability (doğru durum bilgisi) |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                   |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | runtime:compliance                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** curl ile anonim istek: https://github.com/tunadeniz1304/booking-platform 200 döndü ve herkese açık depo başlığını gösteriyor; workflows/security.yml ve SECURITY.md de 200. Not ise 'Yayınlanmadı: depo şu an özel (private)…' diyor; sbomNote '(depo erişimi gerekir)' diyor.

**Etki:** Güven sayfasında çelişkili ve eski bilgi bulunması sayfanın tamamına olan güveni düşürüyor.

**Önerilen aksiyon:** Scorecard sonucunu yayımlayıp rozet ya da bağlantı verin, ya da metni güncelleyin. Durum metinlerini derleme zamanı bir bayrağa bağlayın.

## F1119 — Öne çıkan fiyatlar gerçek dünyayla uyuşmuyor: New York ₺520, Amsterdam ₺260, Kapadokya ₺3.200

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Gözlemlendi                               |
| Konum               | `prisma/seed.ts:642`                      |
| Kullanıcılar        | misafir                                   |
| Prensip             | learnability · Learnability / familiarity |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi               |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | runtime:home                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** RUNTIME tarama 000 bodyTextSample ve crops/home/000-anon-tr-desktop-_-1.png: 'New York Central Park View … ₺520,00', 'Amsterdam Canal House … ₺260,00', 'Kapadokya Sultan Cave Hotel … ₺3.200,00'. Kod: seed.ts:642 basePrice: 520 ve 581 basePrice: 260 (yurt dışı mülkler TRY olarak USD/EUR ölçeğinde girilmiş). Ayrıca page.tsx:86-99 PropertyCard'a property.currency geçirilmiyor (varsayılan 'TRY').

**Etki:** Demo da olsa, Manhattan'da gecelik ₺520 güvenilmez görünüyor. Kullanıcı fiyat bilgisinin doğruluğundan şüphe ediyor.

**Önerilen aksiyon:** Yurt dışı mülklerin seed fiyatlarını TRY ölçeğine çevir (ör. ×35) ya da currency alanını USD/EUR yapıp page.tsx'te currency={property.currency} geçir.

## F1252 — EN metinlerde çoğul hataları ('1 listings selected') ve TR'de yorum/değerlendirme terim tutarsızlığı

| Alan                | Değer                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                        |
| Durum               | Aday                                                                                                                       |
| Konum               | `messages/en/compare.json:7`                                                                                               |
| Diğer konumlar      | `messages/en/compare.json:13`, `messages/en/compare.json:22`, `messages/tr/compare.json:22`, `messages/tr/search.json:106` |
| Kullanıcılar        | misafir                                                                                                                    |
| Prensip             | learnability · consistency                                                                                                 |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                |
| Renk/tema           | Hayır                                                                                                                      |
| Efor                | S                                                                                                                          |
| Kaynak denetçiler   | area:cards                                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                               |

**Kanıt:** en/compare.json:7 `'{count} listings selected'`. Çubuk 1 seçimde de görünüyor (CompareBar.tsx:20), bu yüzden her EN kullanıcısı '1 listings selected' görüyor. 13: `{guests} guests`; 22: `({count} reviews)`. TR'de kart '{count} değerlendirme' (search.json:106), karşılaştırma ise '{count} yorum' (compare.json:22) diyor.

**Etki:** Dil bilgisi hataları özen eksikliği izlenimi veriyor. Aynı kavram için iki farklı terim kullanılması kullanıcının bunları farklı metrikler sanmasına yol açabiliyor.

**Önerilen aksiyon:** EN'de ICU çoğul kullanın: `{count, plural, one {# listing selected} other {# listings selected}}`, guests ve reviews için de aynı yapı. TR'de tek terim seçin ('değerlendirme') ve compare.json:22'yi buna göre güncelleyin.

## F1253 — EN metinlerde ICU çoğul kullanılmayan sayı ifadeleri ('1 listings selected', '±1 days', 'guest(s)')

| Alan                | Değer                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                           |
| Durum               | Aday                                                                                                                                                                                          |
| Konum               | `messages/en/compare.json:7`                                                                                                                                                                  |
| Diğer konumlar      | `messages/en/property.json:19-20`, `messages/en/search.json:36`, `messages/en/search.json:130`, `messages/en/reviews.json:42`, `messages/en/host.json:131-133`, `messages/en/payouts.json:43` |
| Kullanıcılar        | tümü                                                                                                                                                                                          |
| Prensip             | learnability · consistency                                                                                                                                                                    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                                         |
| Efor                | S                                                                                                                                                                                             |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                  |

**Kanıt:** en/compare.json:7 '{count} listings selected', 13 '{guests} guests', 22 '{count} reviews'; en/property.json:19-20 '{guests} guest(s)', 33-34 'minimum {count} nights'; en/search.json:36 'Showing {shown} results', 130 '±{days} days' (FLEX_OPTIONS 1 içerir → '±1 days'); en/reviews.json:42; en/host.json:131-133; en/payouts.json:43. Diğer anahtarların çoğu `{count, plural, one {...} other {...}}` kullanıyor.

**Etki:** EN kullanıcı dilbilgisi hataları görür; ürün özensiz algılanır.

**Önerilen aksiyon:** Bu anahtarları ICU plural'a çevirin (ör. '{count, plural, one {# listing selected} other {# listings selected}}', '±{days, plural, one {# day} other {# days}}'); CI'da TR/EN anahtarlarında `{count}` geçip plural içermeyen EN metinleri yakalayan bir lint ekleyin.

## F1254 — Takvim metinlerinde çoğul ve kısaltma pürüzleri (EN 'guest(s)', TR 'min')

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Low                            |
| Durum               | Aday                           |
| Konum               | `messages/en/property.json:19` |
| Diğer konumlar      | `messages/tr/property.json:34` |
| Kullanıcılar        | misafir                        |
| Prensip             | learnability · consistency     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar    |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:pdp                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** messages/en/property.json:19-20 '… for 1 night, {guests} guest(s) …' ICU plural yok; messages/tr/property.json:34 'min {count} gece' (Türkçede 'en az').

**Etki:** Cila: EN'de '1 guest(s)', TR'de İngilizce kısaltma.

**Önerilen aksiyon:** EN: `{guests, plural, one {# guest} other {# guests}}`; TR: 'en az {count} gece' (dar hücrede '≥3 gece' + aria-label'da tam metin).

## F1255 — Metin tutarsızlıkları: EN çoğul hataları, TR başlıklarda büyük harf karışıklığı, '...' ile '…' farkı

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                       |
| Durum               | Aday                                                                                      |
| Konum               | `messages/en/search.json:36`                                                              |
| Diğer konumlar      | `messages/en/search.json:130`, `messages/tr/search.json:21`, `messages/tr/search.json:35` |
| Kullanıcılar        | misafir                                                                                   |
| Prensip             | learnability · consistency                                                                |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                               |
| Renk/tema           | Hayır                                                                                     |
| Efor                | S                                                                                         |
| Kaynak denetçiler   | area:results                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                              |

**Kanıt:** en/search.json:36 'Showing {shown} results ({total} found)' tek sonuçta 'Showing 1 results' üretiyor; en/search.json:130 '±{days} days' de '±1 days' üretiyor. guestCount ICU plural kullanıyor, bu iki anahtar kullanmıyor. tr/search.json:21 'Fiyat Aralığı' ve :26 'Konaklama Türü' Başlık Düzeninde; :128 'Tarih esnekliği' ve compliance.json:83 'Erişilebilirlik (doğrulanmış)' cümle düzeninde. tr/search.json:35'te 'Yükleniyor...' (üç nokta), aynı dosyadaki 'Harita yükleniyor…' ise '…' kullanıyor. tr/search.json:25'teki 'Max' Türkçede 'Maks.' olmalı.

**Etki:** EN kullanıcı dilbilgisi hatalı metin görüyor; panel başlıkları tutarsız bir görünüm veriyor.

**Önerilen aksiyon:** EN: `{shown, plural, one {Showing # result} other {Showing # results}}` ve `±{days, plural, one {# day} other {# days}}` kullanın. TR lejantlarını cümle düzenine çekin ('Fiyat aralığı', 'Konaklama türü'). Tüm yükleniyor metinlerinde '…' kullanın; 'Max' yerine 'Maks.' yazın.

## F1256 — Aralıklarda tire tutarsız ('Check-in - Check-out', '0-12'); üç nokta karışık

| Alan                | Değer                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                              |
| Durum               | Aday                                                                                                                                                             |
| Konum               | `messages/en/search.json:48`                                                                                                                                     |
| Diğer konumlar      | `messages/tr/search.json:48`, `messages/tr/search.json:50`, `messages/tr/search.json:56`, `messages/tr/search.json:69`, `src/components/search/SearchBar.tsx:62` |
| Kullanıcılar        | misafir                                                                                                                                                          |
| Prensip             | learnability · consistency                                                                                                                                       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                            |
| Efor                | S                                                                                                                                                                |
| Kaynak denetçiler   | area:home                                                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                     |

**Kanıt:** EN'de `"dates": "Check-in - Check-out"` (48) ve `"checkInOnly": "{date} - check-out?"` (50): kendisi tireli sözcükler arasında boşluklu kısa çizgi kullanılıyor. TR'de `"Giriş - Çıkış"` (messages/tr/search.json:48), aralık özetinde `${formatShort(checkIn)} - ${formatShort(checkOut)}` (SearchBar.tsx:62), yaş aralığında '0-12 yaş' / 'Ages 0-12' (56) var. Üç nokta da karışık: `"Aranıyor..."` (69) ile aynı dosyadaki `"Harita yükleniyor…"` farklı.

**Etki:** EN'de 'Check-in - Check-out' ayırıcısı sözcük içindeki tirelerle karışıyor; ekran okuyucular '-' işaretini 'eksi' ya da 'tire' diye okuyor.

**Önerilen aksiyon:** Aralıklarda en dash kullanın: 'Giriş – Çıkış', 'Check-in – Check-out', '{date} – çıkış?', '0–12 yaş'. SearchBar.tsx:62'de `' – '` yazın ve '...' yerine '…' kullanın.

## F1257 — Metin üslubu tutarsız: büyük harf kullanımı, üç nokta, nokta ve tarih etiketi

| Alan                | Değer                        |
| ------------------- | ---------------------------- |
| Severity            | Low                          |
| Durum               | Aday                         |
| Konum               | `messages/tr/account.json:3` |
| Diğer konumlar      | `messages/en/account.json:3` |
| Kullanıcılar        | tümü                         |
| Prensip             | learnability · consistency   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar  |
| Renk/tema           | Hayır                        |
| Efor                | S                            |
| Kaynak denetçiler   | area:account                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)** |

**Kanıt:** account.json'da 'Çıkış Yap' (3), 'Rezervasyonu İptal Et' (34), 'Favorilere Ekle' (38) her kelimesi büyük; 'Oturumu kapat' (95), 'Passkey ekle' (59) cümle düzeninde. 'Yükleniyor...' (51) ve 'İptal ediliyor...' (35) üç nokta; 'Oturumlar yükleniyor…' (87) tek karakter üç nokta. 'Passkey eklendi.' (62) noktalı, 'Oturum kapatıldı' (100) noktasız. 'Eklendi {date}' (54) ile 'Açılış: {date}' (92) farklı kalıpta.

**Etki:** Aynı sayfada farklı üsluplar bütünlük algısını bozuyor ve metinleri bakımı zorlaştırıyor.

**Önerilen aksiyon:** Cümle düzeni, '…' karakteri ve tam cümlelik onaylarda nokta kuralını benimseyin. 'Eklendi {date}' yerine 'Eklenme: {date}' yazın. Aynı düzeni EN dosyasında da uygulayın.

## F1258 — Büyük harf kullanımı ve EN yazımı (ABD/İngiltere) tutarsız

| Alan                | Değer                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                              |
| Durum               | Aday                                                                                                                             |
| Konum               | `messages/tr/account.json:3`                                                                                                     |
| Diğer konumlar      | `messages/tr/nav.json`, `messages/tr/auth.json:7`, `messages/en/search.json`, `messages/en/footer.json`, `messages/en/host.json` |
| Kullanıcılar        | tümü                                                                                                                             |
| Prensip             | learnability · consistency                                                                                                       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                      |
| Renk/tema           | Hayır                                                                                                                            |
| Efor                | S                                                                                                                                |
| Kaynak denetçiler   | lens:copy                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                     |

**Kanıt:** TR: account 'Çıkış Yap' / nav 'Çıkış yap'; auth.login.title 'Giriş Yap' / nav 'Giriş yap'; account 'Rezervasyonu İptal Et' / payment.cancel.button 'Rezervasyonu iptal et'; search 'Fırsatı Gör', 'Fiyat Aralığı', 'Konaklama Türü' (Title Case) yanında cümle düzeni. EN: 'Sign Out'/'Sign out', 'My Account'/'My account'; account 'Favorites' / search.card 'favourites'; 'Licence', 'Help Centre', 'Partner programme', 'Personalisation' yanında 'Trust center', 'Resolution center' ve en-US tarih/para biçimi.

**Etki:** Aynı eylem farklı yazıldığında kullanıcılar farklı işlev sanabilir; marka/ton tutarsızlığı.

**Önerilen aksiyon:** Yazım kılavuzu belirleyin: TR'de cümle düzeni (yalnız ilk harf büyük), EN'de tek varyant (en-US biçimiyle uyumlu 'favorites', 'license', 'center'); messages dosyalarını bu kurala göre normalleştirin.

## F1259 — TR arayüzde jargon ve karışık dil: 'Fraud', 'Outbox', 'DEAD mesajlar', 'Kol', '%95 Wilson'

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                   |
| Durum               | Aday                                                                                  |
| Konum               | `messages/tr/admin.json:53`                                                           |
| Diğer konumlar      | `messages/tr/admin.json:24`, `messages/tr/admin.json:26`, `messages/tr/admin.json:84` |
| Kullanıcılar        | admin                                                                                 |
| Prensip             | learnability · familiarity                                                            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                           |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | area:admin                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                          |

**Kanıt:** tr/admin.json:53 `"title": "Fraud inceleme kuyruğu"`, 24 `"title": "Outbox"`, 26 `"deadTitle": "DEAD mesajlar"`, 84 `"ci": "%95 Wilson"`, 80 `"arm": "Kol"`. Kartlarda bu terimleri açıklayan bir yardım metni yok.

**Etki:** Yeni katılan bir yönetici ya da teknik olmayan bir operasyon personeli 'DEAD', 'Wilson' ve 'Kol' terimlerini anlamıyor. Kartın amacını öğrenmek için dokümana bakması gerekiyor.

**Önerilen aksiyon:** Şu karşılıkları kullanın: 'Dolandırıcılık inceleme kuyruğu', 'Olay gönderim kuyruğu (outbox)', 'Başarısız (DEAD) mesajlar', 'Varyant', '%95 güven aralığı (Wilson)'. Her kart başlığının altına tek cümlelik amaç açıklaması ekleyin (ör. 'Teslim edilemeyen olay mesajları; yeniden kuyruğa alarak tekrar deneyin.').

## F1260 — Etiketlerde büyük harf kullanımı ve ayırıcılar tutarsız

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Low                            |
| Durum               | Aday                           |
| Konum               | `messages/tr/booking.json:4`   |
| Diğer konumlar      | `messages/tr/checkout.json:13` |
| Kullanıcılar        | misafir                        |
| Prensip             | learnability · consistency     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar    |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:widget                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** tr/booking.json:4 "Rezervasyon Yap", :6 "Misafir Sayısı", :8 "Oda Seçimi", :16 "Rezervasyonu Onayla" Başlık Düzeninde; :11 "Fiyat seçeneği" ve quote.json:18 "Kupon kodu" cümle düzeninde. booking.json:5 "Giriş - Çıkış" kısa çizgi kullanıyor, checkout.json "dates": "Giriş – Çıkış" uzun çizgi. EN tarafında da "Book a stay" ve "Number of guests" karışık.

**Etki:** Aynı kutudaki etiketler farklı yazım kurallarıyla görünüyor; arayüzün tutarlılık algısı zayıflıyor ve sonraki çevirilerde hata riski artıyor.

**Önerilen aksiyon:** Tüm alan etiketlerini cümle düzenine çek ("Rezervasyon yap", "Misafir sayısı", "Oda", "Fiyat seçeneği"). Tarih ayırıcısını her yerde " – " (uzun çizgi) yap.

## F1261 — Terim tutarsızlıkları: 'Konaklamayı Görüntüle' ilan sayfasına gidiyor, 'check-in'/'Giriş', 'Seyahatlerim'/'Rezervasyonlarım'

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Aday                          |
| Konum               | `messages/tr/booking.json:55` |
| Diğer konumlar      | `messages/tr/pwa.json:29`     |
| Kullanıcılar        | misafir                       |
| Prensip             | learnability · consistency    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar   |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:trips                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** TR 'viewProperty': 'Konaklamayı Görüntüle' `/property/${booking.property.id}` adresine gidiyor (page.tsx:184), EN karşılığı 'View property'. Push açıklaması 'check-in'den önce' (pwa.json:29) derken diğer yerlerde 'Giriş' kullanılıyor (booking.json:50, pwa.json:18). Kesişen listeler için 'Seyahatlerim' (trips) ve 'Rezervasyonlarım' (account) adları birlikte kullanılıyor.

**Etki:** Misafir 'Konaklamayı Görüntüle'nin bu rezervasyonu açacağını sanıyor ama ilan sayfasına gidiyor. Aynı kavram için farklı kelimeler öğrenmeyi zorlaştırıyor.

**Önerilen aksiyon:** 'Konaklamayı Görüntüle' → 'Tesisi görüntüle'. 'check-in'den önce' → 'giriş gününden önce'. Kısa bir terim sözlüğü belirle (Giriş/Çıkış, Rezervasyon no, Seyahatlerim = yaklaşan onaylı rezervasyonlar) ve tüm namespace'lerde uygula.

## F1262 — Alan jargonu ve aynı nesne için tutarsız adlandırma

| Alan                | Değer                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                                                                        |
| Durum               | Aday                                                                                                                                       |
| Konum               | `messages/tr/cart.json:25`                                                                                                                 |
| Diğer konumlar      | `messages/tr/cart.json:13`, `messages/tr/cart.json:15`, `messages/tr/cart.json:36`, `messages/tr/cart.json:38`, `messages/tr/cart.json:75` |
| Kullanıcılar        | misafir                                                                                                                                    |
| Prensip             | learnability · familiarity / consistency                                                                                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                      |
| Efor                | S                                                                                                                                          |
| Kaynak denetçiler   | area:cart                                                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                               |

**Kanıt:** tr:25 "{name} kalemini kaldır" ve tr:13 "Sepetteki tüm kalemler silinsin mi?" ('kalem' muhasebe terimi); tr:15 'Tutmayı bırak', tr:38 'Odaları tut'; tr:75 'Siz (organizatör)'. Aynı nesne sepet sayfasında 'Sepetim' (tr:2), checkout'ta 'Grup rezervasyonu' (tr:36); tek kişi iki oda alsa da 'grup' deniyor.

**Etki:** Düşük okuryazarlıklı misafir 'kalem/tutma' sözcüklerini anlamayabilir; 'Grup rezervasyonu' başlığı yanlış sayfada olduğunu düşündürebilir.

**Önerilen aksiyon:** 'kalem' → 'oda' ("{name} odasını sepetten kaldır"); 'Odaları tut' → 'Odaları 15 dk ayırt'; 'Tutmayı bırak' → 'Ayırmayı iptal et'; 'organizatör' → 'düzenleyen'; checkout başlığı → 'Rezervasyonu tamamla'. EN karşılıklarını da hizala.

## F1263 — '{time}'e' sabit eki Türkçe ses uyumunu bozuyor

| Alan                | Değer                        |
| ------------------- | ---------------------------- |
| Severity            | Low                          |
| Durum               | Aday                         |
| Konum               | `messages/tr/cart.json:41`   |
| Diğer konumlar      | `messages/tr/payment.json:9` |
| Kullanıcılar        | misafir                      |
| Prensip             | learnability · familiarity   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi  |
| Renk/tema           | Hayır                        |
| Efor                | S                            |
| Kaynak denetçiler   | area:cart                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)** |

**Kanıt:** tr:41 `"heldUntil": "Tüm odalar {time}'e kadar sizin için tutuluyor."`: docs/img/v4-checkout-cart.png'de "15:27'e" (doğrusu "15.27'ye"); 14:30 için "'a", 16:00 için "'ya" gerekir. messages/tr/payment.json:9 holdUntil aynı kalıp.

**Etki:** TR metin bozuk görünür; ödeme ekranında güveni azaltır.

**Önerilen aksiyon:** Eksiz kalıp kullan: "Odalar saat {time} itibarıyla serbest bırakılacak" veya "Tutma bitişi: {time}".

## F1264 — Karşılaştırma girişinde iç jargon: 'teklif motoru' / 'quote engine'

| Alan                | Değer                        |
| ------------------- | ---------------------------- |
| Severity            | Low                          |
| Durum               | Aday                         |
| Konum               | `messages/tr/compare.json:3` |
| Diğer konumlar      | `messages/en/compare.json:3` |
| Kullanıcılar        | misafir                      |
| Prensip             | learnability · familiarity   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi  |
| Renk/tema           | Hayır                        |
| Efor                | S                            |
| Kaynak denetçiler   | area:cards                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)** |

**Kanıt:** tr/compare.json:3: 'Toplam fiyatlar teklif motorundan gelir.'; en/compare.json:3: 'Totals come from the quote engine.' compare/page.tsx:236 bunu `intro` olarak gösteriyor.

**Etki:** Misafir 'teklif motoru'nun ne olduğunu bilmiyor; cümle güven vermek yerine kafa karıştırıyor.

**Önerilen aksiyon:** 'Toplam fiyatlar seçtiğiniz tarih ve misafir sayısı için vergi ve ücretler dahil hesaplanır.' / 'Totals include taxes and fees for your dates and guests.' gibi bir metin kullanın.

## F1265 — Karşılaştırmada AI metni 'Yorum' başlıklı; misafir yorumlarıyla karışıyor

| Alan                | Değer                              |
| ------------------- | ---------------------------------- |
| Severity            | Low                                |
| Durum               | Aday                               |
| Konum               | `messages/tr/compare.json:43`      |
| Diğer konumlar      | `src/app/compare/page.tsx:222-227` |
| Kullanıcılar        | misafir                            |
| Prensip             | learnability · familiarity         |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi        |
| Renk/tema           | Hayır                              |
| Efor                | S                                  |
| Kaynak denetçiler   | lens:copy                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**       |

**Kanıt:** compare.json:43 'commentary': 'Yorum' (EN 'Commentary'); aynı tabloda compare.json:22 '({count} yorum)' misafir yorumu anlamında. compare/page.tsx:222-227 AI özetinin başlığı.

**Etki:** Misafir AI tarafından üretilmiş metni gerçek bir misafir yorumu sanabilir.

**Önerilen aksiyon:** Başlığı 'Yapay zekâ karşılaştırma özeti' / 'AI comparison summary' yapın.

## F1266 — Geri bağlantısı ok karakterini metin olarak okutuyor ve panelin başına götürüyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `messages/tr/host.json:7`                       |
| Diğer konumlar      | `src/app/host/messages/[bookingId]/page.tsx:18` |
| Kullanıcılar        | ev sahibi                                       |
| Prensip             | learnability · consistency                      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                     |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:trips                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** 'back': '← Ev sahibi paneli' metnindeki ok ekran okuyucuda 'sol ok' diye okunuyor. `href='/host'` (host/messages/[bookingId]/page.tsx:18) panelin başına götürüyor; rezervasyon kartının `id='host-bookings'` çapası mevcut (HostDashboard.tsx:126).

**Etki:** Ev sahibi her dönüşte mülk panelleri boyunca aşağı kaydırıp rezervasyon tablosunu yeniden buluyor.

**Önerilen aksiyon:** Oku JSX'te `<span aria-hidden='true'>←</span>` olarak ayır. Metni 'Ev sahibi paneli – Rezervasyonlar' yap ve href'i `/host#host-bookings` olarak ver.

## F1267 — Geri bağlantılarının yeri ve biçimi sayfadan sayfaya değişiyor; ok işaretleri çeviri metnine gömülü ve ekran okuyucuya okunuyor

| Alan                | Değer                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                                               |
| Konum               | `messages/tr/host.json:7`                                                                                                                                                                                                                          |
| Diğer konumlar      | `messages/tr/host.json:10`, `src/app/resolution/[id]/page.tsx:14-21`, `src/app/host/messages/[bookingId]/page.tsx:18-20`, `src/app/checkout/cart/page.tsx:279-281`, `src/app/admin/page.tsx:17-32`, `src/components/host/HostDashboard.tsx:89-110` |
| Kullanıcılar        | ev sahibi, admin, misafir                                                                                                                                                                                                                          |
| Prensip             | learnability · consistency                                                                                                                                                                                                                         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                                                              |
| Efor                | S                                                                                                                                                                                                                                                  |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                       |

**Kanıt:** host.json:7 `"back": "← Ev sahibi paneli"` ve :10 `"revenueLink": "Gelir paneli: … →"`: oklar metnin içinde ve aria-hidden değil. Buna karşılık PriceCalendar.tsx:211 ve :219, SmartFilter.tsx:143 sembolleri `aria-hidden` span içinde veriyor. Konum: resolution/[id]/page.tsx:14-21 geri bağlantısını PageShell intro'suna koyuyor, host/messages/[bookingId]/page.tsx:18-20 kartın üstüne, checkout/cart/page.tsx:279 eylem düğmesinin altına. admin/claims, admin/payouts, admin/support, admin/compliance, host/revenue ve host/payouts sayfalarında üst panele dönüş bağlantısı yok. Admin ve host alt menüleri satır içi '·' ile ayrılmış bağlantılar (admin/page.tsx:17-32, HostDashboard.tsx:89-110).

**Etki:** Ekran okuyucu 'sol ok, Ev sahibi paneli' diye okur. Kullanıcı geri dönüşü her sayfada farklı bir yerde arar. Admin alt sayfalarında dönüş için Header'a gitmek gerekir.

**Önerilen aksiyon:** PageShell'e `backHref` ve `backLabel` prop'ları ekleyin ve geri bağlantısını h1'in üstünde, sabit konumda, `<span aria-hidden>←</span>` ile render edin. Çeviri metinlerinden okları kaldırın. Tüm alt sayfalarda (admin/_, host/_, resolution/[id], host/messages) bu prop'u kullanın. Admin ve host alt menüsünü `<nav aria-label>` içinde bir liste olarak ortak bir `SubNav` bileşenine taşıyın.

## F1268 — Terim tutarsızlığı (Mülk/İlan, Genç/Yeni hesap, Durdur/Pasif, Tutuldu)

| Alan                | Değer                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                               |
| Durum               | Aday                                                                                                              |
| Konum               | `messages/tr/host.json:20`                                                                                        |
| Diğer konumlar      | `messages/tr/trust.json:54`, `messages/tr/trust.json:60`, `messages/tr/host.json:138`, `messages/tr/host.json:32` |
| Kullanıcılar        | ev sahibi                                                                                                         |
| Prensip             | learnability · consistency                                                                                        |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                       |
| Renk/tema           | Hayır                                                                                                             |
| Efor                | S                                                                                                                 |
| Kaynak denetçiler   | area:host                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                      |

**Kanıt:** host.json:20 'property': 'Mülk' ve page.intro 'Mülklerinizi' vs host.json:55 'İlan yayında', :136 'Tüm ilanlarım', trust.json:60 'property': 'İlan'; trust.json:54 intro 'Genç hesap' vs :67 'YOUNG_ACCOUNT': 'Yeni hesap'; host.json:140 eylem 'Durdur' → :138 durum 'Pasif'; :32 'HELD': 'Tutuldu' belirsiz.

**Etki:** Host aynı kavram için farklı kelimeler görür; 'Tutuldu' rezervasyonun ne durumda olduğunu anlatmaz.

**Önerilen aksiyon:** Tek terim ('İlan') kullan; 'Yeni hesap' iki yerde; durum 'Durduruldu'; HELD → 'Ödeme bekleniyor (geçici tutma)'. EN dosyalarında da eşle.

## F1269 — Tutma süresi metninde sabit "'e" eki saatlerin çoğunda dilbilgisi hatası üretiyor

| Alan                | Değer                        |
| ------------------- | ---------------------------- |
| Severity            | Low                          |
| Durum               | Aday                         |
| Konum               | `messages/tr/payment.json:9` |
| Kullanıcılar        | misafir                      |
| Prensip             | learnability · familiarity   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi  |
| Renk/tema           | Hayır                        |
| Efor                | S                            |
| Kaynak denetçiler   | area:checkout                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)** |

**Kanıt:** payment.json:9 `"holdUntil": "Oda sizin için {time}'e kadar tutuluyor."`. docs/img/v5-rnpl-checkout.png ekranında "15:27'e kadar" görünüyor; doğrusu "15:27'ye". 14:30 için "'a", 16:00 için "'ya" gerekir. Ek, saat değerine göre değişmiyor.

**Etki:** TR misafir için metin özensiz görünüyor ve ödeme adımında güveni zedeliyor.

**Önerilen aksiyon:** Metni ekten bağımsız yazın: "Oda sizin için saat {time} itibarıyla tutuluyor; bu saate kadar ödemeyi tamamlayın." ya da "Tutma süresinin bitişi: {time}".

## F1270 — '{time}'e kadar' sabit eki çoğu saatte dil bilgisi hatası üretiyor

| Alan                | Değer                        |
| ------------------- | ---------------------------- |
| Severity            | Low                          |
| Durum               | Aday                         |
| Konum               | `messages/tr/payment.json:9` |
| Kullanıcılar        | misafir                      |
| Prensip             | learnability · familiarity   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi  |
| Renk/tema           | Hayır                        |
| Efor                | S                            |
| Kaynak denetçiler   | area:trips                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)** |

**Kanıt:** 'Oda sizin için {time}'e kadar tutuluyor.' metni `f.time(holdExpiresAt)` ile dolduruluyor (BookingActions.tsx:270). Sonuçlar '14:30'e', '16:00'e', '10:40'e' oluyor; doğrusu '14:30'a', '16:00'ya', '10:40'a'.

**Etki:** Para ve süre içeren kritik bir mesajda yazım hatası güveni azaltıyor.

**Önerilen aksiyon:** Eksiz bir kalıp kullan: 'Oda sizin için tutuluyor. Son ödeme saati: {time}.'

## F1271 — Saat ifadesine sabit Türkçe ek eklenmiş ('{time}'e kadar'); ünlü uyumu birçok saatte bozuluyor

| Alan                | Değer                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                               |
| Durum               | Aday                                                                                                              |
| Konum               | `messages/tr/payment.json:9`                                                                                      |
| Diğer konumlar      | `messages/tr/cart.json:41`, `src/components/booking/BookingActions.tsx:270`, `src/app/checkout/cart/page.tsx:294` |
| Kullanıcılar        | misafir                                                                                                           |
| Prensip             | learnability · real-world match                                                                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                       |
| Renk/tema           | Hayır                                                                                                             |
| Efor                | S                                                                                                                 |
| Kaynak denetçiler   | lens:consistency                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                      |

**Kanıt:** payment.json:9 `"holdUntil": "Oda sizin için {time}'e kadar tutuluyor."` ve cart.json:41 `"heldUntil": "Tüm odalar {time}'e kadar sizin için tutuluyor."`. `{time}` BookingActions.tsx:270 ve checkout/cart/page.tsx:294'te `f.time()` ile üretiliyor ("14:30"), sonuç "14:30'e kadar" oluyor (doğrusu "14:30'a").

**Etki:** Ödeme süresi gibi kritik bir bilgide dil hatası güven duygusunu zedeler. Cila düzeyinde bir sorundur.

**Önerilen aksiyon:** Eki kaldıran bir kalıp kullanın: "Oda sizin için saat {time} itibarıyla serbest bırakılacak" ya da "Son ödeme saati: {time}". Aynısını cart.checkout.heldUntil için de yapın.

## F1272 — Türkçe ek uyumu yer tutucuya sabitlenmiş ('14:30'e kadar', '%10'i')

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Low                                                       |
| Durum               | Aday                                                      |
| Konum               | `messages/tr/payment.json:9`                              |
| Diğer konumlar      | `messages/tr/cart.json:41`, `messages/tr/payouts.json:43` |
| Kullanıcılar        | misafir, ev sahibi                                        |
| Prensip             | learnability · familiarity                                |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                               |
| Renk/tema           | Hayır                                                     |
| Efor                | S                                                         |
| Kaynak denetçiler   | lens:copy                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** payment.json:9 'Oda sizin için {time}'e kadar tutuluyor.'; cart.json:41 'Tüm odalar {time}'e kadar...' — '14:30'e' yerine '14:30'a', '10:00'a' olmalı; payouts.json:43 'payınızın %{reserve}'i' — '%10'u', '%20'si' olmalı.

**Etki:** Birçok saat/oran değerinde dilbilgisi hatalı cümle oluşur.

**Önerilen aksiyon:** Eki kaldıran kalıplar kullanın: 'Oda sizin için saat {time} itibarıyla serbest kalacak' / '{time} saatine kadar'; 'payınızın %{reserve} kadarı'.

## F1273 — TR politika metninde sabit "'i" eki dil bilgisi hatası üretiyor

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Aday                          |
| Konum               | `messages/tr/payouts.json:43` |
| Kullanıcılar        | ev sahibi                     |
| Prensip             | learnability · familiarity    |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi   |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:host2                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** messages/tr/payouts.json:43 `"…payınızın %{reserve}'i {days} gün rezervde tutulur."` — %5'i doğru, ancak %10 → '%10'i' (doğrusu %10'u), %20 → '%20'i' (doğrusu %20'si), %0 → '%0'i' (doğrusu %0'ı).

**Etki:** Para politikası metni oran değiştiğinde hatalı Türkçe gösterir ve güvenilirliği zedeler.

**Önerilen aksiyon:** Eke bağımlı olmayan ifade kullanın: '…payınızın %{reserve} kadarı {days} gün rezervde tutulur.' veya 'Rezerv oranı: %{reserve} ({days} gün)'.

## F1274 — Mevzuat dili (md. 5/2-c, meşru menfaat, takma ad, JSON) sade özet olmadan sunuluyor; güncelleme tarihi yok

| Alan                | Değer                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                        |
| Durum               | Aday                                                                                                                       |
| Konum               | `messages/tr/privacy.json:22`                                                                                              |
| Diğer konumlar      | `messages/tr/privacy.json:43`, `messages/tr/privacy.json:50`, `messages/en/privacy.json:43`, `src/app/privacy/page.tsx:26` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                         |
| Prensip             | learnability · familiarity                                                                                                 |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                |
| WCAG                | 3.1.5                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                      |
| Efor                | S                                                                                                                          |
| Kaynak denetçiler   | area:account2                                                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                               |

**Kanıt:** privacy.json:22 "...ifası (KVKK md. 5/2-c), ... (md. 5/2-ç), ... meşru menfaat (md. 5/2-f) ... açık rızanız (md. 5/1)..."; :43 accountPage.intro "KVKK md. 11 kapsamındaki haklarınızı buradan kullanabilirsiniz."; :50 "JSON olarak indirin. Parola özeti dışa aktarılmaz."; :53 "takma adla değiştirilir". EN'de 'KVKK' kısaltması accountPage.intro'da açıklanmıyor. privacy/page.tsx:26-34 başlıkta 'son güncelleme' tarihi yok.

**Etki:** Okuryazarlığı düşük misafir neyin neden işlendiğini ve sayfada ne yapabileceğini anlamıyor; 'JSON' dosyasının ne olduğunu bilmiyor.

**Önerilen aksiyon:** privacy/page.tsx başlığının altına 3-4 maddelik sade özet kutusu ('Kısaca: …') ekleyin; accountPage.intro'yu "Verilerinizin bir kopyasını indirebilir veya hesabınızı silebilirsiniz." yapın; exportBody'de "JSON (makinece okunabilir metin dosyası)" açıklaması verin; başlığa `<p>Son güncelleme: <time dateTime=…></time></p>` ekleyin.

## F1275 — Aynı kavram için 'değerlendirme' ve 'yorum' terimleri karışık

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Aday                          |
| Konum               | `messages/tr/property.json:4` |
| Diğer konumlar      | `messages/tr/reviews.json:2`  |
| Kullanıcılar        | misafir                       |
| Prensip             | learnability · consistency    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar   |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:pdp                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** messages/tr/property.json:4 `"ratingCount": "{count} değerlendirme"` (sayfa başı) ↔ messages/tr/reviews.json:2 'Misafir yorumları', :11 '{count} yoruma dayanır'.

**Etki:** Misafir '260 değerlendirme' ile 'yorumlar'ın aynı şey olup olmadığını sorguluyor (sayılar da farklı).

**Önerilen aksiyon:** Tek terim kullanın: '{count} yorum' (EN 'reviews' zaten tutarlı).

## F1276 — Sıralama sayfasının metinleri arayüzle uyuşmuyor: var olmayan 'en çok beğenilen' sıralaması ve 'bağlantı' denen açılır panel

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Low                                                         |
| Durum               | Aday                                                        |
| Konum               | `messages/tr/ranking.json:33`                               |
| Diğer konumlar      | `messages/en/ranking.json:33`, `messages/tr/ranking.json:4` |
| Kullanıcılar        | misafir                                                     |
| Prensip             | learnability · consistency                                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                 |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | area:results                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** tr/ranking.json:33 'Fiyat, puan veya en çok beğenilen sıralamalarını seçtiğinizde...' (en/ranking.json:33'te 'most liked') diyor; oysa sıralama seçenekleri yalnızca recommended/price_asc/price_desc/rating (src/lib/search/params.ts:28; search/page.tsx:389-392). ranking.json:4 intro'su 'Bu sıralama neden? bağlantısı' diyor; RankingWhy.tsx:22-25 ise bir `<details>/<summary>` açılır paneli.

**Etki:** Misafir sıralama seçeneklerinde 'en çok beğenilen'i arıyor ve bulamıyor; sayfada 'bağlantı' olarak anılan öğeyi kartta tanıyamıyor.

**Önerilen aksiyon:** Dipnotu 'Fiyat veya puana göre sıraladığınızda yalnızca o ölçüt kullanılır.' olarak düzeltin. Intro'da 'bağlantısı' yerine 'açılır bölümü' yazın; TR ve EN dosyalarının ikisinde de.

## F1277 — Küme etiketi cihaza bağlı 'tıklayın' talimatı içeriyor

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Low                                                                      |
| Durum               | Aday                                                                     |
| Konum               | `messages/tr/search.json:77`                                             |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:195`, `messages/en/search.json:77` |
| Kullanıcılar        | misafir                                                                  |
| Prensip             | accessibility · WCAG 1.3.3 Sensory Characteristics                       |
| Sezgisel madde      | H14 — Erişilebilirlik                                                    |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | area:cards                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                             |

**Kanıt:** search.json:77 '{count} konaklama; yakınlaştırmak için tıklayın', en: 'click to zoom in'. ResultsMap.tsx:195 bunu aria-label olarak kullanıyor.

**Etki:** Klavye, ekran okuyucu ve dokunmatik kullanıcıya 'tıklayın' deniyor; talimat kullandığı girdi yöntemine uymuyor.

**Önerilen aksiyon:** '{count} konaklama — yakınlaştır' / '{count} stays — zoom in' gibi eylem odaklı bir metin kullanın.

## F1278 — 'Fırsatı Gör' kart eylemi indirim vaat ediyor, yalnız ilan sayfasını açıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `messages/tr/search.json:111`                  |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:194` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · predictability (feedforward)    |
| Sezgisel madde      | H13 — Feedforward                              |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | lens:copy                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** search.json:111 'seeDeal': 'Fırsatı Gör' / EN 'See deal' → PropertyCard.tsx:190-195 başlık bağlantısıyla aynı href'e gider; ortada bir fırsat/indirim yoktur.

**Etki:** Misafir indirim bekler, normal fiyatla karşılaşınca güven azalır.

**Önerilen aksiyon:** Metni 'Odaları ve fiyatları gör' / 'See rooms' yapın; erişilebilir adı başlıkla tekrar etmesin diye `aria-label='{title} için odaları gör'` ekleyin.

## F1279 — TR'de 'Talepler' iki farklı varlık için kullanılıyor (hasar/iade talepleri ve destek kayıtları)

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Low                              |
| Durum               | Aday                             |
| Konum               | `messages/tr/support.json:24`    |
| Diğer konumlar      | `messages/tr/resolution.json:17` |
| Kullanıcılar        | admin                            |
| Prensip             | learnability · consistency       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar      |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:admin                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**     |

**Kanıt:** tr/support.json:24 `"title": "Talepler"` (destek kuyruğu) ve tr/resolution.json:17 `"title": "Talepler"` (hasar/iade). EN'de ise 'Tickets' ve 'Claims' olarak ayrışıyor. tr/compliance.json'da da 'kaldırma talepleri' geçiyor.

**Etki:** Ana panodan iki farklı 'Talepler' ekranına giden yönetici hangi kuyrukta olduğunu karıştırabiliyor. Kardeşler arası iletişimde ('talebi çözdüm') belirsizlik doğuyor.

**Önerilen aksiyon:** Destek kuyruğu için 'Destek kayıtları' kullanın (support.admin.title, updated: 'Destek kaydı güncellendi.'). Resolution kartı için 'Hasar ve iade talepleri' kullanın. Terimleri bir sözlükte sabitleyin.

## F1280 — TR arayüzde 'cashback' ve 'kredi' terimleri hedef kitle için yanıltıcı

| Alan                | Değer                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                      |
| Durum               | Aday                                                                                                     |
| Konum               | `messages/tr/wallet.json:17`                                                                             |
| Diğer konumlar      | `src/components/account/WalletPanel.tsx:102`, `messages/tr/wallet.json:13`, `messages/tr/wallet.json:15` |
| Kullanıcılar        | misafir                                                                                                  |
| Prensip             | learnability · familiarity                                                                               |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                              |
| WCAG                | 3.1.3                                                                                                    |
| Renk/tema           | Hayır                                                                                                    |
| Efor                | S                                                                                                        |
| Kaynak denetçiler   | area:account2                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                             |

**Kanıt:** wallet.json:17 "balance": "Kullanılabilir kredi"; :13 "%{rate} cashback kazanırsınız"; :15 "... sonra {tier} seviyesi (%{rate} cashback)."; :11 "tierBadge": "{tier} seviye" → ekranda "Üye seviye" (docs/img/v4-wallet.png; Türkçede 'Üye seviyesi' olmalı). WalletPanel.tsx:102 ve :89'da kullanılıyor.

**Etki:** Okuryazarlığı düşük TR misafir 'kredi'yi banka kredisi/borç, 'cashback'i yabancı terim olarak algılıyor; 'Üye seviye' dil bilgisi hatası güveni azaltıyor.

**Önerilen aksiyon:** "Kullanılabilir kredi" → "Kullanılabilir cüzdan bakiyesi"; "cashback" → "para iadesi (cashback)" ilk geçişte, sonra "para iadesi"; tierBadge → "{tier} üyelik" ya da seviyeye göre "Üye seviyesi/Altın seviye" için ICU select; nextTier → "{count} konaklama daha tamamlayınca {tier} seviyesine geçersiniz (%{rate} para iadesi)."

## F1281 — Bekleyen cashback yalnız oranla gösteriliyor, tutar yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `messages/tr/wallet.json:33`                     |
| Diğer konumlar      | `src/components/account/WalletPanel.tsx:290-294` |
| Kullanıcılar        | misafir                                          |
| Prensip             | robustness · observability                       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                   |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | lens:copy                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** wallet.json:33 '{date} tarihinde krediye dönüşür (%{rate}); iade/talep penceresi bekleniyor.' — WalletPanel pendingCashback öğesinde tutar ve hangi rezervasyon olduğu yok.

**Etki:** Misafir ne kadar kredi kazanacağını hesaplamak zorunda kalır.

**Önerilen aksiyon:** Sunucudan beklenen tutarı ve ilan adını döndürüp '₺X ({ilan}) — {tarih}'te krediye dönüşür' biçiminde gösterin.
