# Sepet ve bölünmüş ödeme — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 83 bulgu · Severity: Critical 1, High 27, Medium 40, Low 15

## F23 — Bölünmüş ödeme sürerken 'Tutmayı bırak' onaysız çalışıyor: tüm katılımcı ödemeleri iptal/iade ediliyor

| Alan                | Değer                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                        |
| Durum               | Aday                                                                                                                                            |
| Konum               | `src/app/checkout/cart/page.tsx:368`                                                                                                            |
| Diğer konumlar      | `src/app/cart/page.tsx:99-106`, `src/app/checkout/cart/page.tsx:348-355`, `src/lib/cart/split-payment.ts:1428-1436`, `messages/tr/cart.json:14` |
| Kullanıcılar        | misafir                                                                                                                                         |
| Prensip             | robustness · recoverability (yıkıcı eylem önleme)                                                                                               |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                |
| WCAG                | 3.3.4                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                           |
| Efor                | M                                                                                                                                               |
| Kaynak denetçiler   | area:cart                                                                                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                                                                   |

**Kanıt:** checkout/cart/page.tsx:368-377 `{held && splitActive && (<button type="button" onClick={release} disabled={busy} ...>{t("release")}</button>)}` ve release() (152-166) doğrudan `apiFetch(`/api/cart/${cart.id}/release`, { method: "POST" })` çağırır; onay yok. Sunucu: split-payment.ts:1428-1436 `releaseCartWithSplit` aktif planda `abortPlan(plan, "CART_RELEASED", CartStatus.OPEN)` → yetkilendirmeler void, tahsilatlar iade, oda tutmaları bırakılır. Aynı düğme sepet sayfasında (cart/page.tsx:99-106 `onClick={() => release(cart.id)}`) ve lockedNotice kullanıcıyı buna yönlendiriyor: "Sepet ödeme için tutuluyor. Değişiklik için tutmayı bırakın." (messages/tr/cart.json:14). Ödeme formunda da (348-355) tam genişlikli 'Tutmayı bırak', birincil 'Öde ve onayla' düğmesinin hemen altında (docs/img/v4-checkout-cart.png, v4-split-payment.png).

**Etki:** Organizatör misafir tek dokunuşla (mobilde yanlış dokunuşla) diğer katılımcıların ödenmiş paylarını iptal ettirir ve tüm odaları kaybeder; envanter başkasına gidebilir, katılımcıların yeniden ödemesi gerekir. Para hatası toleransı çok düşük kullanıcı sınıfı için geri alınamaz; ekran okuyucu kullanıcısına sonuç da bildirilmez.

**Önerilen aksiyon:** release() öncesine özel onay diyaloğu (role="alertdialog", aria-labelledby/aria-describedby, açılışta odak 'Vazgeç'te) ekle. Plan aktifken metin: "Tutmayı bırakırsanız {n} katılımcının ödemesi ({funded}) iptal/iade edilir ve odalar serbest kalır. Bu işlem geri alınamaz."; düğmeler 'Vazgeç' (birincil) ve 'Tutmayı bırak ve ödemeleri iptal et'. Plan yokken kısa onay: "Odalar artık sizin için ayrılmayacak.". lockedNotice'e split aktifse bu sonucu ekle. Ödeme formundaki release'i pay düğmesinden ayır (mt-6, metin bağlantısı görünümü). İşlem sonrası role="status" ile "Tutma bırakıldı; {n} ödeme iade edildi" bildir.

**Yapılan düzeltme:** checkout/cart/page.tsx release(): useConfirm (tone=danger, focus starts on Cancel) runs before the API call. While a split is active, the dialog states the number of payments made and the paid amount, and says invite links stop working and the action cannot be undone (releaseConfirm.splitBody, button 'Bölüşmeyi iptal et ve odaları bırak'). Without a split it shows a short notice (releaseConfirm.title/body). After the release, role=status reports released/releasedSplit. In the payment form the release button is moved away from the primary pay button (pt-3 wrapper, min-h-[44px]). The lockedNotice on the cart page is crossOwner. — dosyalar: `src/app/checkout/cart/page.tsx`

## F94 — Her eşzamansız işlemde odak <body>'ye düşüyor (kaldır, kişi sayısı, oda adedi, tut, paylar, davet, öde)

| Alan                | Değer                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                            |
| Durum               | Gözlemlendi                                                                                                     |
| Konum               | `src/app/cart/page.tsx:22`                                                                                      |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx`, `src/components/cart/SplitPayPanel.tsx`, `src/app/pay/share/[token]/page.tsx` |
| Kullanıcılar        | misafir                                                                                                         |
| Prensip             | accessibility · Gözlemlenebilirlik / klavye ile işletilebilirlik                                                |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                           |
| WCAG                | 2.4.3 Focus Order (A)                                                                                           |
| Renk/tema           | Hayır                                                                                                           |
| Efor                | M                                                                                                               |
| Kaynak denetçiler   | runtime:cart                                                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartA)                                                                                   |

**Kanıt:** Probe p1-remove: 2. kalemin 'Kaldır' düğmesi Enter ile tetiklendi. Kaldırmadan sonra document.activeElement=body, sonraki Tab 'Ödemeye geç' oldu. Probe p3-edit: Yetişkin alanına 3 yazıp Tab basıldı. Odak 'Çocuk' alanına geçerken mutate() setBusy(true) çalıştırıyor, bu da tüm input ve select'lere disabled veriyor (cart/page.tsx:146,159,173,186). Sonuç 'focus: body'. Oda adedi select'i değişince de 'focus: body' oldu. Probe p4-hold: 'Odaları tut' tıklandıktan sonra 'after hold focus: body'. p12: tutma başarısız olduğunda da body. p5: 'Payları oluştur' hata döndürünce body. p6: oluşturmadan sonra ve 'E-postayla gönder'den sonra body. p9: share 'Payımı öde' hatasından sonra body. Hepsi desktop 1280 TR.

**Etki:** Klavye ve ekran okuyucu kullanıcıları her değişiklikten sonra yerlerini kaybediyor ve sayfanın başından tekrar gezinmek zorunda kalıyor. Sepetteki iki alanı art arda düzenlemek bile mümkün değil.

**Önerilen aksiyon:** Odaktaki kontrolü disabled yapma; yerine aria-disabled ve aria-busy kullan, çift gönderimi busy bayrağıyla engelle. İçerik kaldırıldığında odağı bilinçli olarak taşı: kalem silinince sonraki kalemin başlık bağlantısına ya da boş-sepet başlığına (tabIndex=-1). Tut işleminden sonra 'Ödeme' başlığına, plan oluşturunca 'Paylar' başlığına, hata çıkınca role=alert kutusuna veya ilgili alana odaklan.

**Yapılan düzeltme:** cart/page.tsx: busy no longer disables controls. Guest inputs use readOnly while busy, and the select, Remove, Release, Reopen and Empty buttons use aria-disabled/aria-busy with a busy guard in mutate(). Inputs and the select are disabled only when the cart is locked (HELD). After a remove, focus moves to the next item's title link (data-item-link), or to the empty-cart h2 (tabIndex=-1) when no items are left; this also happens after emptying the cart. pay/share/[token]/page.tsx: the Pay and Verify buttons use aria-disabled/aria-busy instead of disabled, and pay/confirm3ds return early while busy, so focus stays on the button after an error. When the 3DS form appears, focus goes to its h2 (tabIndex=-1); after a successful payment it goes to the success message. The hold/plan/invite cases on checkout/cart and SplitPayPanel belong to another owner. — dosyalar: `src/app/cart/page.tsx`, `src/app/pay/share/[token]/page.tsx`

## F95 — Başarılı sepet işlemleri yardımcı teknolojiye bildirilmiyor; /cart sayfasında hiç canlı bölge yok

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | High                                                     |
| Durum               | Gözlemlendi                                              |
| Konum               | `src/app/cart/page.tsx:65`                               |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx`                         |
| Kullanıcılar        | misafir                                                  |
| Prensip             | accessibility · Gözlemlenebilirlik (Dix) / geri bildirim |
| Sezgisel madde      | H12 — Feedback                                           |
| WCAG                | 4.1.3 Status Messages (AA)                               |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | runtime:cart                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartA)                            |

**Kanıt:** p1-remove (desktop TR): kaldırmadan önce live regions=[] çıktı. Kaldırmadan sonra yalnızca Next route announcer var ve içi boş. 'Kaldırıldı' gibi bir mesaj yok; toplamın ₺7.458,18'den ₺3.258,18'e düşmesi duyurulmuyor. p3: oda adedi 2 yapılınca toplam ₺10.716,36 oldu, bu da duyurulmadı. p4-hold: tutma başarılı olduktan sonra 'Tüm odalar 00:22'e kadar...' metni canlı bölge dışında render ediliyor. Tek polite bölge (checkout/cart/page.tsx:259) yalnızca hata için kullanılıyor ve içi boş. Sweep 068/069 sonuçlarında da alerts=[].

**Etki:** Ekran okuyucu kullanıcısı kalemin silindiğini, toplamın değiştiğini ya da odaların tutulduğunu öğrenemiyor ve işlemi tekrar deneyebilir.

**Önerilen aksiyon:** cart/page.tsx'te her zaman DOM'da duran bir <div role="status" aria-live="polite"> ekle ve buraya 'X sepetten kaldırıldı. Yeni toplam ₺…' ya da 'Sepet güncellendi: ₺…' yaz. checkout/cart'ta tutma başarılı olunca bitiş saatini aynı status bölgesine yaz.

**Yapılan düzeltme:** cart/page.tsx: an sr-only <p role=status aria-live=polite> region is always in the DOM. Each successful mutation writes a message to it: cart.announce.updated/removed (both include the new total), cleared, released, reopened. Announcing the hold success on checkout/cart belongs to another owner. — dosyalar: `src/app/cart/page.tsx`

## F96 — Yetişkin/Çocuk alanında geçersiz değer sessizce yok sayılıyor; alan sunucu değerinden ayrışıyor; hata alan ve sınır belirtmiyor

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | High                                                           |
| Durum               | Gözlemlendi                                                    |
| Konum               | `src/app/cart/page.tsx:147`                                    |
| Kullanıcılar        | misafir                                                        |
| Prensip             | robustness · Gözlemlenebilirlik / tutarlı durum (Dix: honesty) |
| Sezgisel madde      | H9 — Hata mesajları                                            |
| WCAG                | 3.3.1 Error Identification (A)                                 |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | runtime:cart                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartA)                                  |

**Kanıt:** p3-edit (desktop TR, sunucu değeri adults=2): '0' yazılıp blur edildi. İstek gitmedi (requests=[]) ve alan '0' göstermeye devam etti; validity=false ama mesaj yok. Boş bırakılınca yine istek yok ve alan '' kaldı. '25' yazılınca PATCH gitti ve 400 döndü; alert yalnızca 'Doğrulama hatası' oldu. reload() sonrası alan hâlâ '25' gösteriyor (defaultValue kontrolsüz) ve odak body'de. Ekran görüntüsü: crops/cart/p3-desktop-tr-adults25.png. İlgili kod: onBlur koşulları satır 147-150 (v>=1) ve 162-165 (v>=0), uncontrolled defaultValue satır 145 ve 160.

**Etki:** Kullanıcı 0 ya da 25 kişi girdiğini sanıyor ama sepet 2 kişiyle fiyatlanıyor. Ödemede beklenmedik doluluk veya fiyat çıkabiliyor. Hata mesajı hangi alanın ve hangi sınırın ihlal edildiğini söylemiyor.

**Önerilen aksiyon:** Alanları kontrollü yap (value=item.adults, yerel taslak state ile). Geçersiz girişte değeri sunucu değerine geri al ve alan altına aria-describedby ile 'Yetişkin sayısı 1–20 arasında olmalı' yaz, aria-invalid=true ver. Alternatif olarak −/+ stepper kullan ve sınırları önceden göster. Sunucu hatasında da alanı sunucu değerine resetle.

**Yapılan düzeltme:** New CartItemRow component: Adults and Children are controlled fields with a local draft that resyncs from the server value whenever item changes (adjust-state-during-render pattern). Changes commit on blur or Enter. The commit checks Number.isInteger and the 1–20 / 0–20 limits. On invalid input the field gets aria-invalid plus an aria-describedby error below it (cart.item.adultsRange/childrenRange: limits plus the saved value), and the field reverts to the saved value. If the server rejects the change, the draft is also reset to the server value. Server error codes are translated through cart.errors.*. — dosyalar: `src/app/cart/page.tsx`

## F97 — Tutma süresi görünmüyor ve uyarı yok; süre dolunca 'tutuluyor' metni kalıyor ve ödeme sonrası açıklama kayboluyor ('Ödenecek sepet yok.')

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | High                                                           |
| Durum               | Gözlemlendi                                                    |
| Konum               | `src/app/checkout/cart/page.tsx:215`                           |
| Diğer konumlar      | `src/app/cart/page.tsx`, `messages/tr/cart.json`               |
| Kullanıcılar        | misafir                                                        |
| Prensip             | robustness · Gözlemlenebilirlik / sistem durumunun görünürlüğü |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                 |
| WCAG                | 2.2.1 Timing Adjustable (A) — süre dolmadan uyarı/uzatma       |
| Renk/tema           | Hayır                                                          |
| Efor                | M                                                              |
| Kaynak denetçiler   | runtime:cart                                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartB)                           |

**Kanıt:** p10-expiry (desktop TR): tutma 3 sn'lik holdExpiresAt ile kuruldu. 5 sn sonra metin hâlâ 'Tüm odalar 00:17'e kadar sizin için tutuluyor.', öde düğmesi aktif ve geri sayım ya da uyarı yok. Kart girilip ödendiğinde stub 409 HOLD_EXPIRED döndü ve sepet null oldu. Ekranda yalnızca 'Ödenecek sepet yok. | Sepete dön' kaldı. setMessage(t('checkout.expired')) çalışıyor, ama satır 215-224'teki erken return message'ı render etmiyor. /cart sayfasındaki kilit bildirimi ('Sepet ödeme için tutuluyor…', cart.json:14) bitiş saatini hiç göstermiyor. CART_HOLD_TTL_MINUTES varsayılanı 15 dk (app-config.ts:58). Ekran görüntüsü: crops/cart/p10-desktop-tr.png

**Etki:** Misafir kart bilgilerini doldururken tutma süresi doluyor. Ödemeden sonra 'ödenecek sepet yok' görüyor, nedenini bilmiyor ve sepetin silindiğini düşünüyor. Odaları kaybetme ve terk riski var.

**Önerilen aksiyon:** Bitişe kalan süreyi canlı bir geri sayımla göster (her dakika güncellenen bir role=timer metni, son 2 dakikada role=alert uyarısı). Mümkünse 'Süreyi uzat' veya 'Yeniden tut' eylemini sun. Süre dolunca formu kapat ve 'Tutma süresi doldu — Odaları yeniden tut' düğmesini göster. noCart dalında message'ı da render et ve /cart'a 'Süresi dolan sepeti geri yükle' bağlamıyla yönlendir. lockedNotice metnine bitiş saatini ekle.

**Yapılan düzeltme:** The remaining time shows as a role=timer next to heldUntil, updated every 10 s (checkout.remaining). With under 2 min left, a role=status warning is announced once (expiringSoon). When time runs out, the payment form is hidden and an 'expired' box gets focus with 'Odaları yeniden tut' (release then 'Odaları tut'). The noCart branch now renders message/notice; after a HOLD_EXPIRED it shows expiredNoCart plus a 'Süresi dolan sepeti geri yükle' (POST /api/cart/reopen) button. Hold extension needs a backend change. lockedNotice on /cart is crossOwner. — dosyalar: `src/app/checkout/cart/page.tsx`

## F98 — Aktif bölünmüş ödeme varken 'Tutmayı bırak' ve 'Sepeti boşalt' katılımcıların ödemelerini sonuçlarını söyleyen bir onay olmadan iptal ediyor

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                       |
| Durum               | Gözlemlendi                                                                                |
| Konum               | `src/app/checkout/cart/page.tsx:348`                                                       |
| Diğer konumlar      | `src/app/cart/page.tsx`, `src/lib/cart/split-payment.ts`, `messages/tr/cart.json`          |
| Kullanıcılar        | misafir                                                                                    |
| Prensip             | robustness · Kurtarılabilirlik / hata önleme (Dix: recoverability, forward error recovery) |
| Sezgisel madde      | H5 — Hata önleme                                                                           |
| WCAG                | 3.3.4 Error Prevention (Legal, Financial, Data) — AA                                       |
| Renk/tema           | Hayır                                                                                      |
| Efor                | M                                                                                          |
| Kaynak denetçiler   | runtime:cart                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartB)                                                       |

**Kanıt:** Probe p7-release.mjs. API page.route ile taklit edildi (DTO'lar src/lib/cart'tan), sayfa anon açıldı. Sepet HELD durumdaydı; plan COLLECTING, bir katılımcı payı AUTHORIZED ('ayse@example.test ₺2.486,06 Ödendi (onay bekliyor)'). /cart (desktop 1280, TR) sayfasında 112x30 boyutundaki 'Tutmayı bırak' düğmesine tek tıklandı: dialogs=[], hemen POST /api/cart/c1/release gitti, ardından odak <body>'ye düştü ve başarı mesajı da çıkmadı. /checkout/cart sayfasındaki 736x38 düğmede sonuç aynı. Sunucuda releaseCartWithSplit (split-payment.ts:1428-1436) abortPlan'i çağırıyor; bu da refundCapturedShares ve voidOpenShares adımlarını çalıştırıp tutmaları bırakıyor (1373-1396). 'Sepeti boşalt' tarafında yalnızca genel bir window.confirm var: 'Sepetteki tüm kalemler silinsin mi?' (cart/page.tsx:45, cart.json:13). Bu metin payların iade veya iptal edileceğini söylemiyor. Ekran görüntüsü: runtime/crops/cart/p7-desktop-tr-cart.png

**Etki:** Organizatör tek tıkla ya da yanlış dokunuşla gruptaki herkesin yetkilendirilmiş ödemesini iptal ediyor, davet bağlantılarını geçersiz kılıyor ve odaları bırakıyor. Katılımcıların baştan ödemesi gerekiyor, odalar da başkasına gidebilir.

**Önerilen aksiyon:** Plan COLLECTING veya FALLBACK durumundayken release() ve clear() çağrılmadan önce sonuçları sayan bir onay penceresi göster (ör. '2 katılımcının ödemesi iptal/iade edilecek, davet linkleri geçersiz olacak, odalar bırakılacak'). Pencerede 'Vazgeç' varsayılan odak olsun, onay düğmesi de eylemi adıyla söylesin ('Bölüşmeyi iptal et ve odaları bırak'). Onay penceresi native confirm yerine role=alertdialog bir modal olsun. İşlemden sonra 'Bölünmüş ödeme iptal edildi; X tutarı iade edilecek' durum mesajını göster.

**Yapılan düzeltme:** Checkout side same as F23: a confirmation that lists the consequences, Cancel focused by default, an action-named button, and a result notice. The release and 'Sepeti boşalt' (window.confirm) on /cart are in cart/page.tsx and are in crossOwner. — dosyalar: `src/app/checkout/cart/page.tsx`

## F99 — Bölünmüş ödeme bağlantısında e-postası doğrulanmamış katılımcı bunu kartını girdikten sonra öğreniyor; doğrulama veya yeniden gönderme yolu yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/app/pay/share/[token]/page.tsx:51`         |
| Diğer konumlar      | `src/app/api/pay/share/[token]/route.ts`        |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · Hata önleme / yardım (feedforward) |
| Sezgisel madde      | H9 — Hata mesajları                             |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | runtime:cart                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartA)            |

**Kanıt:** p9-share-pay (desktop TR): ShareViewDTO stub'landı (canPay=true). Kart 4242… ve CVC girilip 'Payımı öde · ₺2.486,06' gönderildi, POST 403 EMAIL_NOT_VERIFIED döndü. Ekrandaki alert: 'Ödeme yapmak için e-posta adresinizi doğrulayın.' Sayfadaki tek eylem yine 'Payımı öde'; doğrulama veya yeniden gönderme bağlantısı yok ve odak <body>'ye düştü. GET yalnızca requireAuth kullanıyor, POST ise requireVerifiedEmail (route.ts). Bu yüzden doğrulama durumu önceden gösterilemiyor. Kod tabanında /api/auth/verify-email/resend için bir UI çağrısı yok (Grep: src/app ve src/components içinde 'resend' ya da 'verify-email/resend' eşleşmesi yok).

**Etki:** Davetle yeni kaydolan katılımcı (en olası senaryo) payını ödeyemiyor ve nasıl ilerleyeceğini bilmiyor. Grup ödemesi son tarihe kadar tamamlanmazsa pay organizatöre düşüyor ya da her şey iade ediliyor.

**Önerilen aksiyon:** ShareViewDTO'ya emailVerified alanını ekle. Doğrulanmamışsa kart formunu göstermeden önce bir bilgi kutusu göster: '<email> adresine doğrulama bağlantısı gönder' düğmesi (POST /api/auth/verify-email/resend), ardından 'E-postanı kontrol et, sonra bu sayfayı yenile'. Hata metninde de aynı eylemi sun.

**Yapılan düzeltme:** pay/share page: when the load or the payment returns EMAIL_NOT_VERIFIED, a recovery section appears under the error with a 'Doğrulama e-postasını yeniden gönder' button (POST /api/auth/verify-email/resend, aria-busy, result in role=status: sent / alreadyVerified / failed) and a 'Sayfayı yenile' button. The early warning before the card form is skipped: it needs backend/API changes (an emailVerified field on ShareViewDTO or SessionUser). — dosyalar: `src/app/pay/share/[token]/page.tsx`

## F100 — Özel tutarlı bölüşmede Türkçe ondalık virgül sessizce reddediliyor; 'Payları oluştur' gerekçe göstermeden pasif kalıyor ve organizatör payı yanlış gösteriliyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | High                                                        |
| Durum               | Gözlemlendi                                                 |
| Konum               | `src/components/cart/SplitPayPanel.tsx:94`                  |
| Diğer konumlar      | `src/lib/money/money.ts`                                    |
| Kullanıcılar        | misafir                                                     |
| Prensip             | robustness · Gözlemlenebilirlik / hata önleme               |
| Sezgisel madde      | H9 — Hata mesajları                                         |
| WCAG                | 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA) |
| Renk/tema           | Hayır                                                       |
| Efor                | M                                                           |
| Kaynak denetçiler   | runtime:cart                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                               |

**Kanıt:** p5-split-create (desktop TR, HELD sepet, toplam ₺7.458,18), 'Özel tutarlar' seçili. '2000,50' ve '1.500' girildi: organizatör payı ₺7.458,18 (tüm toplam), submit disabled, alerts=[], aria-invalid=null. Aynı değerler '2000.50' ve '1500' yazılınca kabul edildi (₺3.957,68). '5000' ve '5000' girildi (toplamı aşıyor): organizatör ₺0,00 olarak gösterildi (Math.max(0,…) satır 255), submit disabled ve açıklama yok. Mobilde 390 genişlikte aynı durum: crops/cart/p5m-1.png. Neden: parseMoney yalnızca /^(\d+)(?:\.(\d+))?$/ kalıbını kabul ediyor (money.ts:181), oysa ekranda tutarlar '₺2.486,06' biçiminde gösteriliyor. Alan etiketi yalnızca 'Tutar (TRY)', biçim ipucu yok.

**Etki:** TR kullanıcısı ekranda gördüğü biçimde (virgüllü) tutar yazınca form neden çalışmadığını söylemeden kilitleniyor. Organizatör payını 'tüm toplam' ya da '₺0,00' olarak görmek dağılımı yanlış anlatıyor. Bölünmüş ödemenin özel modu fiilen kullanılamaz hale geliyor.

**Önerilen aksiyon:** Girdiyi yerel ayara göre ayrıştır: TR'de virgülü ondalık, noktayı binlik say (Intl.NumberFormat parçalarıyla normalize et) ve gönderirken '2000.50' biçimine çevir. Geçersiz satırda aria-invalid ver ve aria-describedby ile satır altı hata göster ('Geçerli bir tutar girin, ör. 2.000,50'). Toplam aşıldığında 'Payların toplamı sepeti ₺2.541,82 aşıyor' de; organizatör payını negatif ya da 'hesaplanamadı' olarak göster, 0'a sabitleme. Submit pasifken nedenini düğmenin yanında metinle yaz.

**Yapılan düzeltme:** SplitPayPanel parses amounts with parseAmountToMinor(text, currency decimal digits) instead of parseMoney, so '2000,50' and '1.500' are accepted. Fields are type=text with inputMode=decimal, with an example-format hint (amountHint) linked via aria-describedby. Invalid or empty rows get aria-invalid and an error under the field. When the total is over, the over-amount appears in text (overTotal), and the organizer share shows '—' plus an explanation instead of 0 or the full total. The submit button is disabled only while busy. On an invalid submit, errors are shown and focus goes to the first invalid field. — dosyalar: `src/components/cart/SplitPayPanel.tsx`

## F101 — EN arayüzde sunucunun Türkçe hata metinleri ham olarak gösteriliyor

| Alan                | Değer                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                 |
| Durum               | Gözlemlendi                                                                                                          |
| Konum               | `src/components/cart/SplitPayPanel.tsx:126`                                                                          |
| Diğer konumlar      | `src/app/cart/page.tsx`, `src/app/checkout/cart/page.tsx`, `src/lib/http/errors.ts`, `src/lib/cart/split-payment.ts` |
| Kullanıcılar        | misafir                                                                                                              |
| Prensip             | learnability · Tutarlılık / gerçek dünya eşleşmesi (dil)                                                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                          |
| WCAG                | 3.1.2 Language of Parts (AA)                                                                                         |
| Renk/tema           | Hayır                                                                                                                |
| Efor                | M                                                                                                                    |
| Kaynak denetçiler   | runtime:cart                                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                                        |

**Kanıt:** p5-split-create (desktop, EN): aynı e-posta iki katılımcıya yazıldı ve sunucu 400 SPLIT_DUPLICATE_EMAIL döndü. EN sayfasındaki alert: 'Aynı e-posta birden çok paya yazılamaz'. Bu metin split-payment.ts:277'de sabit Türkçe. p3-edit (desktop, EN): Adults=25 girilince alert 'Doğrulama hatası' çıktı (errors.ts:154 ZodError). İstemci err.message'ı doğrudan basıyor: SplitPayPanel.tsx:126 ve 154, cart/page.tsx:28, checkout/cart/page.tsx:50, 93 ve 162. Türkçe parça lang='en' sayfada lang özniteliği olmadan duruyor.

**Etki:** EN kullanıcısı hatayı anlayamıyor ve düzeltemiyor. Ekran okuyucu da Türkçe metni İngilizce telaffuzla okuyor.

**Önerilen aksiyon:** İstemcide err.code'a göre çeviri anahtarına eşle (SPLIT_DUPLICATE_EMAIL, SPLIT_AMOUNT_INVALID, VALIDATION_ERROR, CART_NOT_HELD …). Eşleşme yoksa yerelleştirilmiş genel mesaja düş (t('updateFailed'), t('createFailed')); ham err.message'ı yalnız geliştirme ortamında göster. VALIDATION_ERROR için details.fieldErrors'tan alan bazlı mesaj üret.

**Yapılan düzeltme:** Both files map err.code to cart.errors.* / cart.split.errors.* keys. Generic codes and network errors fall back to useErrorText (common.errors). Any other ApiError gets a localized message (createFailed/sendFailed/updateFailed/holdFailed/payment.failed), and raw server text is no longer shown. The other err.message spot in cart/page.tsx is crossOwner. — dosyalar: `src/app/checkout/cart/page.tsx`, `src/components/cart/SplitPayPanel.tsx`

## F102 — Bölüşme arayüzünde birbirinin aynı erişilebilir adlar, legend'sız radyo grubu ve yalnızca placeholder ile etiketli e-posta alanı

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                               |
| Durum               | Gözlemlendi                                                                                        |
| Konum               | `src/components/cart/SplitPayPanel.tsx:186`                                                        |
| Kullanıcılar        | misafir                                                                                            |
| Prensip             | accessibility · Algılanabilirlik / tanıma > hatırlama                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                              |
| WCAG                | 1.3.1 Info and Relationships (A), 2.4.6 Headings and Labels (AA), 3.3.2 Labels or Instructions (A) |
| Renk/tema           | Hayır                                                                                              |
| Efor                | S                                                                                                  |
| Kaynak denetçiler   | runtime:cart                                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                      |

**Kanıt:** p5 (desktop TR): fieldset {legend:null, aria-label:null} (satır 186), yani 'Eşit böl' ve 'Özel tutarlar' radyolarının grup sorusu yok. Kaldır düğmelerinin hepsinin adı 'Katılımcıyı kaldır' (satır 235). Özel modda tutar etiketleri ['Tutar (TRY)','Tutar (TRY)'] (satır 216). Eşit modda satır tutarı '₺2.486,06' etiketsiz bir <span> (satır 228). p6 durum listesi: copy düğmeleri ['Linki kopyala','Linki kopyala'] ve 'E-postayla gönder'×2. E-posta alanı 'E-posta (isteğe bağlı)' yalnızca placeholder ve aria-label ile var, görünür etiket yok (satır 339-346); yazmaya başlayınca kayboluyor. Mobil görünüm: crops/cart/p6m-0.png

**Etki:** Ekran okuyucu kullanıcısı düğme ve form listelerinde hangi katılımcıyı kaldırdığını, kopyaladığını veya davet ettiğini ayırt edemiyor. Görsel kullanıcı yazmaya başlayınca alanın ne olduğunu unutuyor.

**Önerilen aksiyon:** <fieldset>'e <legend>Nasıl bölünsün?</legend> ekle. Satır düğmelerine bağlamlı ad ver: aria-label='Katılımcı 1 linkini kopyala' (görünür metni içerecek biçimde), 'Katılımcı 2'yi kaldır', 'Katılımcı 1 için e-postayla gönder'. Tutar etiketini 'Katılımcı 1 tutarı (TRY)' yap. Eşit pay metnini 'Payı: ₺…' olarak etiketle. Durum listesindeki e-posta alanına görünür bir <label> ekle.

**Yapılan düzeltme:** The fieldset got a <legend> (modeLegend). The remove button has a numbered label (removeParticipantN) and a 44px target. Amount labels have an sr-only 'Katılımcı n ·' prefix and htmlFor/id links. The equal share shows 'Payı: {amount}'. Copy and send buttons have context-specific names that contain the visible text ('Linki kopyala: {name}', 'E-postayla gönder: {name}'). The invite email field now has a visible label instead of the placeholder (inviteEmailLabel + sr-only name). — dosyalar: `src/components/cart/SplitPayPanel.tsx`

## F159 — Misafir sayısı alanları kontrolsüz: ekrandaki değer kaydedilen değerden farklı kalabiliyor

| Alan                | Değer                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                              |
| Durum               | Aday (3 kaynak birleşti)                                                                          |
| Konum               | `src/app/cart/page.tsx:145`                                                                       |
| Diğer konumlar      | `src/app/cart/page.tsx:160-165`, `src/app/cart/page.tsx:162-165`, `src/app/cart/page.tsx:170-174` |
| Kullanıcılar        | misafir                                                                                           |
| Prensip             | robustness · observability                                                                        |
| Sezgisel madde      | H5 — Hata önleme                                                                                  |
| WCAG                | 3.3.1                                                                                             |
| Renk/tema           | Hayır                                                                                             |
| Efor                | M                                                                                                 |
| Kaynak denetçiler   | area:cart, lens:forms, lens:consistency                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartA)                                                                     |

**Kanıt:** 145-150 `defaultValue={item.adults}` + `onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v !== item.adults) void patch(item, { adults: v }); }}`. 0 veya boş giriş sessizce yok sayılır, alanda '0' kalır. 25 (max=20) veya 2.5 gönderilir; sunucu reddedince reload() item.adults'ı eski değere çeker ama defaultValue DOM'u güncellemez, alan 25'i göstermeye devam eder. Çocuk alanında (160-165) aynı. Enter ile kaydetme, 'kaydedildi' geri bildirimi ve alan düzeyinde hata yok.

**Etki:** Misafir 3 yetişkin girdiğini sanar, sepette 2 kayıtlıdır; fiyat ve oda kapasitesi yanlış rezervasyona gider (tarih/para hatası toleransı çok düşük).

**Önerilen aksiyon:** value+onChange ile kontrollü alan; commit'te `Number.isInteger(v) && v >= min && v <= max` kontrolü; geçersizse aria-invalid="true" + aria-describedby ile alan altı hata ("Yetişkin sayısı 1–20 arasında olmalı"). Hata/yeniden yüklemede yerel değeri sunucu değerine sıfırla. Alternatif: − / + adım düğmeleri (aria-label "{property} için yetişkin sayısını azalt").

**Yapılan düzeltme:** Same issue as F96: the fields are now controlled, with validation, an error under the field, a revert on error, and Enter to save. — dosyalar: `src/app/cart/page.tsx`

## F168 — Tutar girişi kuralları ekranlar arasında farklı; bölünmüş ödemede '250,50' sessizce geçersiz sayılıyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                       |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                   |
| Konum               | `src/components/cart/SplitPayPanel.tsx:100`                                                                                                                                                                                                                                                                                                                                |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:262`, `src/components/resolution/shared.tsx:142-150`, `src/components/transfers/TransferMarket.tsx:122`, `src/components/host/HostDashboard.tsx:250-259`, `src/components/account/AgentMandates.tsx:119-127`, `src/components/booking/WalletCreditOption.tsx:86-94`, `src/lib/money/money.ts:181`, `src/lib/money/money.ts:177-187` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                                                                                                                                                                                  |
| Prensip             | robustness · consistency / error prevention                                                                                                                                                                                                                                                                                                                                |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                                        |
| WCAG                | 3.3.1                                                                                                                                                                                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                      |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:consistency, lens:forms                                                                                                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartB)                                                                                                                                                                                                                                                                                                                                       |

**Kanıt:** SplitPayPanel.tsx:100 `parseMoney(r.amount || "x", currency)` kullanıyor. lib/money/money.ts:181'deki regex `/^(\d+)(?:\.(\d+))?$/` yalnızca noktayı kabul ediyor. Geçersizlikte :104 `customValid = false` oluyor, :262'de düğme `disabled` kalıyor ve hiçbir hata metni gösterilmiyor. Virgülü kabul eden yerler: resolution/shared.tsx:145 `value.trim().replace(",", ".")` (OpenClaimForm, ClaimAdmin, DepositSettings) ve TransferMarket.tsx:122. `type="number"` (tarayıcıya bağlı) kullananlar: HostDashboard.tsx:252, :380, :401, :501, AgentMandates.tsx:121, PromotionsPanel.tsx:256. WalletCreditOption.tsx:90-93 ise para birimi üssünü hesaba katan yardımcılar yerine sabit `/ 100` ve `* 100` kullanıyor.

**Etki:** TR klavyesiyle "250,50" yazan organizatör bölünmüş ödeme oluşturamaz ve nedenini göremez, düğme sadece pasif kalır. Aynı kullanıcı talep formunda virgülle başarılı olur. Ev sahibi fiyat alanında tarayıcıya göre farklı ayırıcı kabulüyle karşılaşır.

**Önerilen aksiyon:** Tüm para girişleri için tek bir `MoneyInput` bileşeni yapın: `inputMode="decimal"`, `type="text"`, ayrıştırma `parseMajorInput` ile, Field içinde, para birimi etiketi ve `error` prop'uyla birlikte. SplitPayPanel geçersiz satırda Field `error` ile "Tutar örn. 250,50 biçiminde olmalı" mesajı göstersin. WalletCreditOption'da `/100` ve `*100` yerine `toMajorNumber` ve `toMinor` kullanılsın.

**Yapılan düzeltme:** The split side uses the shared parseAmountToMinor (see F100). The shared MoneyInput component and the WalletCreditOption/HostDashboard/AgentMandates changes are in other owners' files. — dosyalar: `src/components/cart/SplitPayPanel.tsx`

## F210 — Sayfa başlıkları tüm akışta aynı; rota değişimi ekran okuyucuya duyurulmuyor

| Alan                | Değer                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                  |
| Durum               | Aday                                                                                                                                  |
| Konum               | `src/app/cart/page.tsx:15`                                                                                                            |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:27`, `src/app/pay/share/[token]/page.tsx:23`, `src/app/layout.tsx:13-17`, `messages/tr/common.json:3` |
| Kullanıcılar        | misafir                                                                                                                               |
| Prensip             | accessibility · Page Titled                                                                                                           |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                 |
| WCAG                | 2.4.2                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                 |
| Efor                | S                                                                                                                                     |
| Kaynak denetçiler   | area:cart                                                                                                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: cartA)                                                                                                        |

**Kanıt:** Üç sayfa da 'use client' ve metadata/generateMetadata içermiyor; src/app/cart, src/app/checkout/cart, src/app/pay/share/[token] altında layout.tsx yok. Tek başlık kökten: layout.tsx:13-17 `title: t("meta.title")` = "booking-platform — konaklama arama ve rezervasyon (demo)" (messages/tr/common.json:3).

**Etki:** Sekme/geçmişte 'Sepetim', 'Grup rezervasyonu', 'Grup rezervasyonu payı' ayırt edilemez; Next.js rota duyurucusu başlık değişmediği için sayfa geçişini bildirmez; e-postadaki linkle gelen katılımcı sekme başlığından sayfanın ne olduğunu anlamaz.

**Önerilen aksiyon:** Her rotaya sunucu layout.tsx ekleyip generateMetadata ile title üret: "{cart.title} · booking-platform", "{cart.checkout.title} · …", "{cart.split.share.title} · …". Başarı/hata durumunda document.title'ı güncelle ('Ödeme onaylandı · …').

**Yapılan düzeltme:** Page titles were handled globally in wave 1: src/app/cart/layout.tsx and pay/share/[token]/layout.tsx have generateMetadata (titles.cart / titles.payShare). No title was added in this wave, as instructed. The dynamic document.title for success/error was not implemented.

## F211 — Sunucu/kütüphane hata metinleri ham ve yalnız Türkçe gösteriliyor (EN arayüzde de)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Konum               | `src/app/cart/page.tsx:28`                                                                                                                                                                                                                                                                                                                                                                                                             |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:50`, `src/app/checkout/cart/page.tsx:93`, `src/app/checkout/cart/page.tsx:114`, `src/app/checkout/cart/page.tsx:162`, `src/components/cart/SplitPayPanel.tsx:126`, `src/components/cart/SplitPayPanel.tsx:154`, `src/app/pay/share/[token]/page.tsx:62`, `src/app/pay/share/[token]/page.tsx:119`, `src/lib/payment/card-token.ts:57-63`, `src/lib/payment/mock-psp.ts:49`, `src/lib/api-client.ts:39` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                                                                                                    |
| WCAG                | 3.1.2                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Kaynak denetçiler   | area:cart                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartA)                                                                                                                                                                                                                                                                                                                                                                                                   |

**Kanıt:** cart/page.tsx:28 `setMessage(err instanceof ApiError ? err.message : t("updateFailed"))`. Aynı desen: checkout/cart/page.tsx:50 `return err.message;`, :93, :114 (CardValidationError: "Kart numarası geçersiz", "Kartın son kullanma tarihi geçmiş" — card-token.ts:57-63 sabit TR), :162; SplitPayPanel.tsx:126, :154; share page:62, :119. 3DS ipucu `outcome.challenge?.hint` sunucuda "Demo doğrulama kodu: ..." (mock-psp.ts:49); api-client.ts:39 `İstek başarısız (${res.status})`. Sunucu örnekleri: "Sepet ödeme için tutuluyor; önce tutmayı bırakın", "Bu sepet için bölünmüş ödeme başlatıldı". Bu metinler lang="en" sayfada lang işaretlemesiz gösterilir.

**Etki:** EN arayüzdeki misafir ödeme ve kart hatalarını Türkçe okur; 'İstek başarısız (500)' gibi teknik metinler her iki dilde de sonraki adımı söylemez.

**Önerilen aksiyon:** İstemcide err.code → messages/<locale>/errors.json eşlemesi (CART_LOCKED, SPLIT_ACTIVE, SPLIT_AMOUNT_INVALID, SPLIT_DUPLICATE_EMAIL, PAYMENT_ATTEMPTS_EXCEEDED, CART_NOT_OPEN, EMAIL_NOT_VERIFIED…); bilinmeyen kodda çevrilmiş genel metin + 'Tekrar dene'. CardValidationError'a code alanı (INVALID_NUMBER / INVALID_CVC / EXPIRED / INVALID_EXPIRY) ekle, metni payment.json'dan al. 3DS ipucunu challenge.type'a göre istemcide çevir.

**Yapılan düzeltme:** cart/page.tsx: CART_LOCKED, CART_NOT_OPEN, CONCURRENT_UPDATE, CONFLICT, VALIDATION_ERROR and NOT_FOUND are translated through cart.errors.*. A code-less ApiError falls back to updateFailed, and anything else goes through common useErrorText (network/5xx/generic codes). share page: the default branch uses useErrorText instead of err.message. CardValidationError is translated by code through payment.errors.<code> (from the wave-1 global patch) with tp.has, falling back to invalidCard. The 3DS hint is no longer the raw server text: for challenge.type 3ds_otp it shows cart.split.share.threeDsIntro, plus threeDsDemoHint when a code can be extracted from the hint. Partial because a 4xx with an unknown domain code still shows the server's Turkish text (useErrorText behaviour), and checkout/cart, SplitPayPanel and api-client belong to other owners. — dosyalar: `src/app/cart/page.tsx`, `src/app/pay/share/[token]/page.tsx`

## F212 — Sepet, ödeme ve paylaşılan ödeme sayfaları ortak sayfa kabuğu, Header ve Footer olmadan render ediliyor

| Alan                | Değer                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                            |
| Durum               | Aday                                                                                                                                                            |
| Konum               | `src/app/cart/page.tsx:63`                                                                                                                                      |
| Diğer konumlar      | `src/app/checkout/page.tsx:150-166`, `src/app/checkout/cart/page.tsx:170-232`, `src/app/pay/share/[token]/page.tsx:157-178`, `src/components/ui/ui.tsx:157-178` |
| Kullanıcılar        | misafir                                                                                                                                                         |
| Prensip             | learnability · consistency / familiarity                                                                                                                        |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                           |
| Efor                | M                                                                                                                                                               |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartA)                                                                                                                            |

**Kanıt:** src/app/cart/page.tsx:63 `return (<main id="main" className="mx-auto max-w-3xl px-4 py-8">` ile başlıyor, Header/Footer import edilmemiş. Aynı durum src/app/checkout/page.tsx:150 ve :166, src/app/checkout/cart/page.tsx:170/178/217/232, src/app/pay/share/[token]/page.tsx:157/170/178 için de geçerli. docs/img/v4-cart.png ekran görüntüsünde demo şeridinin hemen altında logo, menü ve dil seçici yok. Buna karşılık 21 sayfa PageShell kullanıyor (ui.tsx:157-178), 10 sayfa da Header+Footer'ı elle ekliyor. 'Sepetim' ise Header menüsünde bir öğe (Header.tsx:24).

**Etki:** Menüden 'Sepetim'e geçen misafir menüyü, logoyu, hesap bağlantısını, dil ve tema seçicisini kaybeder. Tek oda checkout sayfasında ilana ya da aramaya dönmek için bir bağlantı da yok, yalnızca tarayıcının geri tuşu kalıyor. Düşük okuryazarlıktaki mobil kullanıcı bu sayfalarda çıkmaza girer. Dili yanlış ayarlı EN kullanıcı ödeme ekranında dili değiştiremez.

**Önerilen aksiyon:** Dört sayfayı da PageShell ile sarın (başlık PageShell'in `title` prop'una). Checkout için bilinçli olarak sadeleştirilmiş bir akış isteniyorsa PageShell'e `variant="checkout"` ekleyin: logo, dil seçici ve 'Geri: ilan / sepet' bağlantısı kalsın, ana menü gizlensin. Tüm ödeme sayfalarında bu varyant kullanılsın.

**Yapılan düzeltme:** Every state of /cart and /pay/share/[token] (loading, error, normal) is now wrapped in PageShell (Header + Footer, h1 from the title prop). Content keeps its width inside a max-w-3xl / max-w-xl div. checkout/page.tsx and checkout/cart/page.tsx belong to other owners and are not covered. — dosyalar: `src/app/cart/page.tsx`, `src/app/pay/share/[token]/page.tsx`

## F213 — Sepette meşgulken tüm kontroller disabled oluyor: klavye odağı kayboluyor, oda adedi her ok tuşunda istek atıyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | High                                                         |
| Durum               | Aday                                                         |
| Konum               | `src/app/cart/page.tsx:146`                                  |
| Diğer konumlar      | `src/app/cart/page.tsx:161`, `src/app/cart/page.tsx:173-174` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | accessibility · Keyboard / Focus Order                       |
| Sezgisel madde      | H14 — Erişilebilirlik                                        |
| WCAG                | 2.4.3                                                        |
| Renk/tema           | Hayır                                                        |
| Efor                | M                                                            |
| Kaynak denetçiler   | area:cart                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartA)                                |

**Kanıt:** 146/161/173 `disabled={locked || busy}`; 147-150 ve 162-165 `onBlur={(e) => { ... void patch(item, { adults: v }); }}`; 174 `onChange={(e) => void patch(item, { quantity: Number(e.target.value) })}`. Yetişkin alanından Tab ile Çocuk alanına geçince blur → patch → setBusy(true) → yeni odaklanan Çocuk alanı disabled olur; HTML focus fixup kuralı odağı body'ye taşır. Windows'ta kapalı select'te ↓ tuşu change tetikler → PATCH → select disabled → odak kaybolur; 3'e çıkmak için her seferinde yeniden odaklanmak gerekir.

**Etki:** Yalnız klavye ya da ekran okuyucu kullanan misafir misafir sayısını/oda adedini düzenleyemez ya da her değişiklikte sayfa başına atılır.

**Önerilen aksiyon:** Global busy yerine kalem bazlı pendingItemId kullan; kontrolleri disabled yerine aria-disabled="true" + olay yok sayma ile kilitle (odak korunur). Select için değer seçimi + 500 ms debounce ya da yalnız blur/Enter'da commit. Mutasyon bitince odağı tetikleyen kontrole geri ver.

**Yapılan düzeltme:** Same mechanism as F94 for controls: no disabled while busy (readOnly/aria-disabled plus a guard), and pendingItemId sets aria-busy on the item being changed. The room-count select is now controlled with a draft; a change commits after a 600 ms debounce or on blur, so arrow keys no longer send a request on every step and focus is not lost. — dosyalar: `src/app/cart/page.tsx`

## F214 — 'Sepeti boşalt' kilitli/bölünmüş ödeme durumunda da etkin ve onay metni gerçek sonucu gizliyor

| Alan                | Değer                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                         |
| Durum               | Aday                                                                                                                                         |
| Konum               | `src/app/cart/page.tsx:222`                                                                                                                  |
| Diğer konumlar      | `src/app/cart/page.tsx:44-50`, `messages/tr/cart.json:13`, `src/lib/cart/split-payment.ts:1439-1444`, `src/lib/cart/cart-service.ts:808-816` |
| Kullanıcılar        | misafir                                                                                                                                      |
| Prensip             | robustness · recoverability                                                                                                                  |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                             |
| WCAG                | 3.3.4                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                        |
| Efor                | M                                                                                                                                            |
| Kaynak denetçiler   | area:cart                                                                                                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartA)                                                                                                         |

**Kanıt:** cart/page.tsx:222-229 'Sepeti boşalt' düğmesi yalnız `disabled={busy}` (diğer düzenleme kontrolleri `disabled={locked || busy}`). clear() (44-50) `window.confirm(t("cancelConfirm"))` = "Sepetteki tüm kalemler silinsin mi?" (tr cart.json:13). DELETE /api/cart/:id → `cancelCartWithSplit` aktif planı `abortPlan(plan, "CART_CANCELLED", CartStatus.CANCELLED)` ile kapatır (split-payment.ts:1439-1444). Geri yükleme yalnız EXPIRED sepetler için (cart-service.ts:811-816 `status: { in: [CartStatus.EXPIRED] }`), yani CANCELLED sepet geri gelmez; buna rağmen boş durumda 'Süresi dolan sepeti geri yükle' düğmesi görünür.

**Etki:** Organizatör split sırasında sepeti 'boşaltınca' katılımcı ödemeleri void/iade olur, oda tutmaları düşer ve sepet kalıcı iptal edilir. Native confirm'in 'Tamam/İptal' düğmeleri TR'de belirsiz ('İptal' burada 'vazgeç' demek).

**Önerilen aksiyon:** HELD durumda düğmeyi gizle ya da onay metnini duruma göre üret: tutma varsa "Odaların tutması bırakılacak", plan varsa "{n} katılımcının ödemesi iptal/iade edilecek". window.confirm yerine etiketli düğmeli diyalog ('Sepeti boşalt' / 'Vazgeç'). İşlem sonrası role="status" ile "Sepet boşaltıldı" ve OPEN sepet için 10 sn 'Geri al' (sunucuda yumuşak iptal veya reopen'in CANCELLED sepeti de kapsaması).

**Yapılan düzeltme:** window.confirm was replaced with useConfirm (tone danger). Title cart.cancelConfirm (new text: 'Sepet boşaltılsın mı?'), confirm label 'Sepeti boşalt', cancel label 'Vazgeç, sepet kalsın'. The body depends on state: when HELD, cancelConfirmHeld explains that the hold is released and any group payments are cancelled and refunded; otherwise cancelConfirmBody says this can't be undone. Success is announced as 'Sepet boşaltıldı' in the status region. After emptying in this session, the 'Süresi dolan sepeti geri yükle' button is hidden, since a CANCELLED cart can't be reopened. Undo is skipped: it needs a backend change (soft cancel/reopen). — dosyalar: `src/app/cart/page.tsx`

## F215 — Onay kuyruğundaki başarılı ödeme kırmızı hata olarak gösteriliyor, ödeme formu açık kalıyor, onaydan sonra 'Ödenecek sepet yok' çıkıyor

| Alan                | Değer                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                           |
| Durum               | Aday                                                                                                           |
| Konum               | `src/app/checkout/cart/page.tsx:77`                                                                            |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:259-265`, `src/app/checkout/cart/page.tsx:215-224`, `messages/tr/cart.json:47` |
| Kullanıcılar        | misafir                                                                                                        |
| Prensip             | robustness · observability                                                                                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                 |
| Renk/tema           | Hayır                                                                                                          |
| Efor                | M                                                                                                              |
| Kaynak denetçiler   | area:cart                                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                                  |

**Kanıt:** 77-81 `if (outcome.status === "pending_confirmation") { setMessage(t("checkout.confirmPending")); await reload(); return; }` — message yalnız hata kutusunda gösterilir: 259-265 `<div role="alert" className="... bg-red-50 ... text-red-700">`. Sepet HELD kaldıkça 285 `held && !challenge && !splitActive` ödeme formu ve 'Öde ve onayla' yeniden görünür. Metin "Sepetinizi yenileyerek durumu görebilirsiniz" (tr cart.json:47) elle yenilemeyi kullanıcıya bırakır; yoklama yok. Onay tamamlanınca sepet CHECKED_OUT → useCart null → 215-224 "Ödenecek sepet yok."; başarı ekranı (176-213) ve rezervasyon bağlantıları hiç gösterilmez.

**Etki:** Parası alınmış misafir 'hata' görüp tekrar ödemeye, başka kart denemeye veya destek aramaya yönelir; onaylı rezervasyonunu bu akışta göremez.

**Önerilen aksiyon:** pending için ayrı bilgi durumu: role="status", ikon + 'Ödemeniz alındı' başlığı (hata kutusu değil), ödeme formunu gizle. 3 sn aralıkla GET /api/cart/${cartId} yokla (en çok ~60 sn); CHECKED_OUT olunca done ekranına geç (bookingIds outcome'da var). Zaman aşımında 'Rezervasyonlar Seyahatlerim'de görünecek' + bağlantı.

**Yapılan düzeltme:** pending_confirmation is no longer shown in the red error box. A separate notice state (role=status) and a 'Ödemeniz alındı' info box (with focus) replace it, and the payment form, split panel and release are hidden. GET /api/cart/{id} is polled every 3 s for at most 20 tries (~60 s). On CHECKED_OUT it switches to the success screen with booking links. On timeout it shows the pendingSlow text and a My trips link. — dosyalar: `src/app/checkout/cart/page.tsx`

## F216 — Sepet ödemesi: 'ödeme alındı, onay bekleniyor' kırmızı hata kutusunda; başarılı ödeme sonrası okuma hatası 'Ödeme başarısız' gösteriyor

| Alan                | Değer                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                              |
| Durum               | Aday                                                                                                                                                              |
| Konum               | `src/app/checkout/cart/page.tsx:79`                                                                                                                               |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:83`, `src/app/checkout/cart/page.tsx:87`, `src/app/checkout/cart/page.tsx:259`, `messages/tr/cart.json (checkout.confirmPending)` |
| Kullanıcılar        | misafir                                                                                                                                                           |
| Prensip             | robustness · observability                                                                                                                                        |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                             |
| Efor                | M                                                                                                                                                                 |
| Kaynak denetçiler   | lens:status                                                                                                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                                                                                     |

**Kanıt:** checkout/cart/page.tsx:77-81 `setMessage(t("checkout.confirmPending"))` → 259-264 tek `message` alanı `role="alert"` ve kırmızı kutu olarak render ediliyor; metin 'Ödemeniz alındı… Sepetinizi yenileyerek durumu görebilirsiniz.' (cart.json) — otomatik takip yok. 83-84 'confirmed' sonucundan sonra `apiFetch(\`/api/cart/${outcome.cartId}\`)`başarısız olursa hata pay()'in catch'ine düşüyor → 87-98 payFailed: 'Ödeme başarısız' +`setPayKey(newKey())`.

**Etki:** Misafir parası çekildiği hâlde kırmızı uyarı ya da 'başarısız' görüyor; tekrar ödemeye veya destek aramaya yöneliyor. Para hatası toleransı en düşük adımda güven kaybı.

**Önerilen aksiyon:** Bilgi mesajları için ayrı `notice` state'i (role=status, ⓘ ikon + 'Bilgi:' öneki, nötr kutu); confirmPending'de 3 sn aralıkla en fazla 60 sn GET /api/cart/{id} yokla, onaylanınca başarı ekranına geç, olmazsa 'Hâlâ işleniyor — e-postayla bilgilendireceğiz' + 'Seyahatlerim' bağlantısı. finish() içindeki GET'i try/catch'e al; hata olursa PayOutcome (bookingIds, amount) ile başarı ekranını yine göster; confirmed sonrası payKey'i değiştirme.

**Yapılan düzeltme:** Same notice/polling as F215. The GET inside finish() is wrapped in try/catch: if the read fails after a confirmed payment, the success screen still shows using the current cart, and payKey does not change (the 'Ödeme başarısız' path is no longer hit). — dosyalar: `src/app/checkout/cart/page.tsx`

## F217 — Tutma süresi dolunca hata mesajı kayboluyor ve kurtarma yolu sunulmuyor

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | High                                                                 |
| Durum               | Aday                                                                 |
| Konum               | `src/app/checkout/cart/page.tsx:90`                                  |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:215-224`, `messages/tr/cart.json:46` |
| Kullanıcılar        | misafir                                                              |
| Prensip             | robustness · recoverability                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                  |
| WCAG                | 3.3.3                                                                |
| Renk/tema           | Hayır                                                                |
| Efor                | M                                                                    |
| Kaynak denetçiler   | area:cart                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                        |

**Kanıt:** payFailed (87-98): `else if (err.code === "HOLD_EXPIRED") { setMessage(t("checkout.expired")); } ... await reload();`. Sepet süre işiyle EXPIRED olduysa useCart null döner ve 215-224 erken dönüş yalnız `<p>{t("checkout.noCart")}</p>` ("Ödenecek sepet yok.") gösterir; `message` bu dalda render edilmez. Sepet henüz HELD ise form aynı kalır ve "Tutma süresi doldu." (tr cart.json:46) sonraki adımı söylemez; yeniden 'Öde' aynı HOLD_EXPIRED'e düşer (src/lib/cart/cart-payment.ts:178-180).

**Etki:** Kart bilgisini girmiş misafir açıklamasız 'Ödenecek sepet yok' görür veya döngüye girer; sepetin geri yüklenip yeniden tutulabileceğini bilmez.

**Önerilen aksiyon:** noCart dalında da message kutusunu render et. Metni "Tutma süresi doldu, odalar serbest bırakıldı. Sepeti geri yükleyip odaları yeniden tutabilirsiniz." yap ve aynı kutuya 'Sepeti geri yükle ve yeniden tut' düğmesi (POST /api/cart/reopen → hold) ekle. HELD ama holdExpiresAt geçmişse ödeme düğmesini gizleyip 'Odaları yeniden tut' göster.

**Yapılan düzeltme:** payFailed HOLD_EXPIRED sets the expired flag. The noCart branch shows the message box with a reopen button. The checkout.expired text now says what to do next. HELD carts past holdExpiresAt hide the pay button and show 'Odaları yeniden tut'. — dosyalar: `src/app/checkout/cart/page.tsx`

## F218 — Adım geçişlerinde (tut → öde → 3DS → başarı) odak yönetimi ve duyuru yok

| Alan                | Değer                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                    |
| Durum               | Aday                                                                                                                                    |
| Konum               | `src/app/checkout/cart/page.tsx:285`                                                                                                    |
| Diğer konumlar      | `src/app/pay/share/[token]/page.tsx:233-321`, `src/components/cart/SplitPayPanel.tsx:174-272`, `src/app/checkout/cart/page.tsx:176-213` |
| Kullanıcılar        | misafir                                                                                                                                 |
| Prensip             | accessibility · Focus Order                                                                                                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                   |
| WCAG                | 2.4.3                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                   |
| Efor                | M                                                                                                                                       |
| Kaynak denetçiler   | area:cart                                                                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                                                           |

**Kanıt:** Tutma bölümü (267-283) kaybolup ödeme formu (285) belirdiğinde, ödeme formu `!challenge` ile kaldırılıp 3DS formu (379-406) geldiğinde ve 176 `if (done)` tüm içeriği değiştirdiğinde hiçbir ref.focus()/tabIndex={-1} yok; odaktaki gönder düğmesi DOM'dan kalkınca odak body'ye düşer. Aynı desen: share page 233-321 (form → 3DS → ödendi) ve SplitPayPanel.tsx:174-272 (oluşturma formu → durum bölümü).

**Etki:** Ekran okuyucu kullanıcısı 3DS kod alanının açıldığını veya ödemenin onaylandığını duymaz; klavye kullanıcısı her adımda sayfa başına ('İçeriğe geç' bağlantısına) döner; bu sırada tutma süresi işler.

**Önerilen aksiyon:** Her adımın başlığına id + tabIndex={-1} ver ve adım değişince `useEffect(() => headingRef.current?.focus(), [step])`. Başarıda h1'e, split planı oluşunca durum bölümünün h2'sine odak. Ek olarak kalıcı role="status" bölgesinde kısa duyuru ('3D Secure doğrulaması gerekli', 'Odalar 15 dk tutuldu').

**Yapılan düzeltme:** A step value is derived (hold/pay/challenge/pending/expired/split/done/none). When it changes, focus moves to the new step's heading or box (tabIndex=-1, focus:outline-none). In SplitPayPanel, focus moves to the status h2 once a plan is created. The share page (pay/share) is outside my files and was not changed. — dosyalar: `src/app/checkout/cart/page.tsx`, `src/components/cart/SplitPayPanel.tsx`

## F219 — 15 dakikalık tutma süresi için geri sayım, uyarı ve uzatma yok

| Alan                | Değer                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                            |
| Durum               | Aday                                                                                                                                                            |
| Konum               | `src/app/checkout/cart/page.tsx:292`                                                                                                                            |
| Diğer konumlar      | `src/app/cart/page.tsx:96-98`, `src/components/cart/SplitPayPanel.tsx:284-286`, `src/app/pay/share/[token]/page.tsx:205-207`, `src/lib/config/app-config.ts:58` |
| Kullanıcılar        | misafir                                                                                                                                                         |
| Prensip             | robustness · observability (zaman sınırı)                                                                                                                       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                  |
| WCAG                | 2.2.1                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                           |
| Efor                | L                                                                                                                                                               |
| Kaynak denetçiler   | area:cart                                                                                                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartB)                                                                                                                            |

**Kanıt:** checkout/cart/page.tsx:292-296 `{cart.holdExpiresAt && (<p className="text-sm text-amber-700">{t("checkout.heldUntil", { time: f.time(cart.holdExpiresAt) })}</p>)}` — yalnız saat (tarih yok), statik, canlı güncelleme yok. CART_HOLD_TTL_MINUTES=15 (src/lib/config/app-config.ts:58); uzatma uç noktası yok. Sepet sayfasında kilitli durumda bitiş saati hiç gösterilmez (cart/page.tsx:96-98 yalnız lockedNotice). Split son ödeme (SPLIT_PAY_DEADLINE_MINUTES=60) organizatöre yalnız mutlak tarih (SplitPayPanel.tsx:284-286), katılımcıya text-xs gri satırda (share page:205-207).

**Etki:** Yavaş yazan, motor/bilişsel engelli ya da 3DS SMS'i bekleyen misafir süre dolduğunu ancak 'Öde'ye bastığında öğrenir; katılımcılar 60 dk sınırını fark etmeden kaçırır ve plan düşer.

**Önerilen aksiyon:** holdExpiresAt'ten kalan süreyi gösteren görünür geri sayım ('12 dk kaldı', dakikada bir güncellenir); yalnız 2 dk ve 30 sn eşiklerinde role="status" duyurusu; bitişten 2 dk önce 'Süreyi uzat' düğmesi (sunucuda tek seferlik +15 dk). lockedNotice'e '{time}'e kadar' bilgisini ekle. Split deadline'ına göreli süre ('45 dk kaldı') ekle.

**Yapılan düzeltme:** Live countdown in checkout plus a one-time 2-minute warning (as in F97). The split deadline gets a relative time (deadlineLeft, updated every 30 s). Not done: a 'Süreyi uzat' button (no backend endpoint), the end time in the cart-page lockedNotice (crossOwner), and the participant share page (other owner). — dosyalar: `src/app/checkout/cart/page.tsx`, `src/components/cart/SplitPayPanel.tsx`

## F220 — Davet linkiyle gelen hesapsız katılımcı kayıt olunca linki kaybediyor; giriş yönlendirmesi bağlamsız

| Alan                | Değer                                   |
| ------------------- | --------------------------------------- |
| Severity            | High                                    |
| Durum               | Aday                                    |
| Konum               | `src/app/pay/share/[token]/page.tsx:77` |
| Diğer konumlar      | `src/app/login/page.tsx:149`            |
| Kullanıcılar        | misafir                                 |
| Prensip             | robustness · task conformance           |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü       |
| Renk/tema           | Hayır                                   |
| Efor                | M                                       |
| Kaynak denetçiler   | area:cart                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartA)    |

**Kanıt:** 76-78 `router.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)`. Giriş sayfasındaki 'Kayıt ol' bağlantısı `href="/register"` (src/app/login/page.tsx:149) redirect parametresini taşımaz; register sayfasında redirect işlenmiyor. Giriş sayfası neden giriş istendiğini açıklamıyor. Ödeme ayrıca doğrulanmış e-posta istiyor (EMAIL_NOT_VERIFIED).

**Etki:** Organizatörün davet ettiği hesapsız katılımcı kayıt sonrası ana sayfaya düşer, ödeme sayfasını bulamaz; 60 dk içinde pay ödenmezse plan organizatöre düşer veya iptal olur.

**Önerilen aksiyon:** Login'deki kayıt bağlantısına `?redirect=` aktar; kayıt ve e-posta doğrulama sonrası ona dön. Share sayfası yönlendirirken `&reason=share` ekle ve login'de "{organizer} sizi grup ödemesine davet etti. Payınızı görmek için giriş yapın veya hesap oluşturun." bilgi kutusu göster.

**Yapılan düzeltme:** The share page builds its login redirect with loginHref(pathname), using the same safe rule. The register link on the login page should carry redirect, and the login page should show a 'you were invited to a group payment' notice; both belong to another owner (login/register pages), see crossOwner. — dosyalar: `src/app/pay/share/[token]/page.tsx`

## F221 — Bölünmüş ödeme (pay/share) hata durumlarında çıkış yolu yok: yanlış hesap, doğrulanmamış e-posta, ödeme sonrası

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | High                                     |
| Durum               | Aday                                     |
| Konum               | `src/app/pay/share/[token]/page.tsx:155` |
| Diğer konumlar      | `src/app/pay/share/[token]/page.tsx:216` |
| Kullanıcılar        | misafir                                  |
| Prensip             | robustness · recoverability              |
| Sezgisel madde      | H9 — Hata mesajları                      |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | lens:nav                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartA)            |

**Kanıt:** 155-167 loadError durumunda tek bağlantı `<Link href="/trips">` ("Seyahatlerim"). SHARE_EMAIL_MISMATCH (49-50, "Bu ödeme linki başka bir kişiye gönderildi") için hesap değiştirme yolu yok; sayfada Header da olmadığı için çıkış düğmesi hiç yok. EMAIL_NOT_VERIFIED (51-52) için yeniden gönderme bağlantısı yok. Ödeme başarılı olunca (216-224) sonraki adım bağlantısı yok. Yükleme durumunda (168-174) h1 yok.

**Etki:** Davetli bir grup üyesi farklı hesapla girmişse bu sayfadan çıkış yapıp doğru hesaba geçemiyor; e-postası doğrulanmamışsa doğrulama tetikleyemiyor. Pay son tarihten önce ödenemezse tümü-ya-hiç kuralı nedeniyle grubun rezervasyonu düşüyor.

**Önerilen aksiyon:** SHARE_EMAIL_MISMATCH için oturumdaki e-postayı gösterin ve "Çıkış yap ve doğru hesapla giriş yap" düğmesi ekleyin (`logout()` sonra `/login?redirect={pathname}`). EMAIL_NOT_VERIFIED için POST /api/auth/verify-email/resend çağıran "Doğrulama e-postasını yeniden gönder" düğmesi ekleyin. Ödeme sonrasına "Seyahatlerim" ve "Ana sayfa" bağlantıları koyun. Yükleme durumunda da h1 render edin.

**Yapılan düzeltme:** SHARE_EMAIL_MISMATCH: shows the signed-in email via useSession (share.signedInAs) and a 'Çıkış yap ve davet edilen hesapla giriş yap' button, which calls logout() and then window.location.assign(loginHref(pathname)). EMAIL_NOT_VERIFIED: resend and refresh actions (see F99). The error screen and the post-payment success message now link to both Seyahatlerim and Ana sayfa. The loading state also has an h1 through PageShell, and the page now has the Header (with sign-out). — dosyalar: `src/app/pay/share/[token]/page.tsx`

## F222 — İptal/iade/süresi doldu durum çiplerinde metin kontrastı 4.5:1'in altında

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | High                                       |
| Durum               | Aday                                       |
| Konum               | `src/components/cart/SplitPayPanel.tsx:25` |
| Kullanıcılar        | misafir                                    |
| Prensip             | accessibility · Contrast (Minimum)         |
| Sezgisel madde      | H14 — Erişilebilirlik                      |
| WCAG                | 1.4.3                                      |
| Renk/tema           | Evet — onaylandı ve uygulandı              |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cart                                  |
| **Düzeltme durumu** | **Düzeltildi (onaylı renk düzeltmesi)**    |

**Kanıt:** 25-27 `VOIDED: "bg-gray-100 text-gray-500"`, `REFUNDED: ...`, `EXPIRED: ...`, 314 `text-xs font-medium`: #6B7280 / #F3F4F6 ≈ 4.40:1 (12px normal metin için 4.5:1 gerekir). Durum metin olarak verildiği için 1.4.1 sorunu yok.

**Etki:** Az gören ve güneş altında mobil kullanan misafir iade/iptal durumunu okuyamayabilir.

**Önerilen aksiyon:** Renk/tema değişikliği gerektirir (kullanıcı kapsam dışı istedi): çip metnini text-gray-600 veya text-gray-700'e yükseltmek. Renk dışı çözüm 12px metinde eşiği karşılamaz; geçici olarak çip yanına aynı durumu açıklayan normal kontrastlı metin eklenebilir.

## F223 — Tutar alanı Türkçe ondalık virgülünü ve binlik noktasını kabul etmiyor

| Alan                | Değer                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                   |
| Durum               | Aday                                                                                                                   |
| Konum               | `src/components/cart/SplitPayPanel.tsx:100`                                                                            |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:118`, `src/components/cart/SplitPayPanel.tsx:218`, `src/lib/money/money.ts:181` |
| Kullanıcılar        | misafir                                                                                                                |
| Prensip             | learnability · familiarity                                                                                             |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                            |
| Renk/tema           | Hayır                                                                                                                  |
| Efor                | S                                                                                                                      |
| Kaynak denetçiler   | area:cart                                                                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                                          |

**Kanıt:** 100 `parseMoney(r.amount || "x", currency)` ve 118 `parseMoney(r.amount, currency)`. parseMoney yalnız `/^(\d+)(?:\.(\d+))?$/` kabul eder (src/lib/money/money.ts:181): "1250,50" ve "1.250" geçersiz. Alan 218 `inputMode="decimal"`; TR yerel ayarlı mobil klavyede ondalık tuşu ','.

**Etki:** Varsayılan dil TR olan misafir kuruşlu tutar giremez; düğme sessizce pasif kalır (önceki bulgu). Binlik ayraçla yazılan '1.250' reddedilir.

**Önerilen aksiyon:** Yerel ayara göre normalize eden `parseLocalizedAmount(text, locale)` ekle (tr: '.' binlik, ',' ondalık; en: tersi) ve parseMoney'e normalize string ver. Etiket altına aria-describedby ile örnek ipucu ("ör. 1250,50"); blur'da değeri yerel biçimde yeniden yaz.

**Yapılan düzeltme:** Same as F100: TR/EN thousands and decimal separators are accepted, and a sample-format hint is linked via aria-describedby. — dosyalar: `src/components/cart/SplitPayPanel.tsx`

## F224 — Bölme planının sonuçları (60 dk süre, ödenmeyen payların organizatöre düşmesi) oluşturmadan önce söylenmiyor

| Alan                | Değer                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                               |
| Durum               | Aday                                                                                                                               |
| Konum               | `src/components/cart/SplitPayPanel.tsx:184`                                                                                        |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:258`, `src/components/cart/SplitPayPanel.tsx:282-291`, `src/lib/config/app-config.ts:65-67` |
| Kullanıcılar        | misafir                                                                                                                            |
| Prensip             | learnability · predictability                                                                                                      |
| Sezgisel madde      | H13 — Feedforward                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                              |
| Efor                | M                                                                                                                                  |
| Kaynak denetçiler   | area:cart                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cartB)                                                                                               |

**Kanıt:** Oluşturma formunda yalnız 184 `t("intro")` ve 258 `t("remainderHint")` var. `deadline` ile `fallbackOrganizer`/`fallbackRefund` metinleri ancak plan oluştuktan sonra gösteriliyor (282-291). Sunucu varsayılanı `SPLIT_PAY_FALLBACK: "organizer"` ve 60 dk süre (app-config.ts:65-67).

**Etki:** Organizatör, katılımcılar ödemezse kalan tutarı kendisinin ödemesi gerektiğini ve 60 dk sınırını taahhüt ettikten sonra öğrenir; para hatası toleransı düşük kullanıcı için beklenmedik yükümlülük.

**Önerilen aksiyon:** 'Payları oluştur' düğmesinin üstüne aria-describedby ile bağlı özet: "Katılımcıların {deadline} içinde ödemesi gerekir. Süre sonunda ödenmemiş paylar size düşer ({fallbackMinutes} dk ek süre)." (fallbackMode'a göre metin). Değerleri GET split yanıtına `config` alanı olarak ekle.

**Yapılan düzeltme:** Above the 'Payları oluştur' button, a summary linked via aria-describedby (beforeCreate) now says payment time is limited and what can happen to unpaid shares at the deadline. The exact deadline minutes and fallback mode are not available before creation; they need a config field in the GET split response (backend). — dosyalar: `src/components/cart/SplitPayPanel.tsx`

## F225 — Özel tutarlarda aşan/geçersiz toplam açıklanmıyor; organizatör payı 0'a kırpılıyor

| Alan                | Değer                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                              |
| Durum               | Aday                                                                                                                                                                              |
| Konum               | `src/components/cart/SplitPayPanel.tsx:255`                                                                                                                                       |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:94-109`, `src/components/cart/SplitPayPanel.tsx:215-226`, `src/components/cart/SplitPayPanel.tsx:262`, `src/lib/cart/split-payment.ts:277` |
| Kullanıcılar        | misafir                                                                                                                                                                           |
| Prensip             | robustness · recoverability                                                                                                                                                       |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                               |
| WCAG                | 3.3.1                                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                             |
| Efor                | M                                                                                                                                                                                 |
| Kaynak denetçiler   | area:cart                                                                                                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: cartB)                                                                                                                                                     |

**Kanıt:** 255 `{f.money(Math.max(0, organizerMinor), currency)}`: toplam aşılınca '₺0,00' gösterir. 262 `disabled={busy || (mode === "custom" && (!customValid || organizerMinor < 0))}` düğmeyi nedeni söylemeden pasifleştirir. Tutar alanlarında (215-226) aria-invalid veya alan altı hata yok. Yinelenen e-posta istemcide kontrol edilmez; sunucu "Aynı e-posta birden çok paya yazılamaz" ham mesajını döner (split-payment.ts:277).

**Etki:** Organizatör 'Payları oluştur'un neden çalışmadığını bulamaz; aşan tutar 0 göründüğü için toplamı doğru sanar.

**Önerilen aksiyon:** organizerMinor < 0 ise role="alert" ile "Paylar toplamı {total} tutarını {excess} aşıyor" göster ve organizatör payını eksi işaret + uyarı ikonuyla yaz. Her tutar alanına aria-invalid + aria-describedby ile alan altı hata ("Geçerli bir tutar girin, ör. 1250,50"). Düğmeyi disabled yerine aria-disabled yap, gönderimde hata özetine odakla. E-postaları istemcide normalize edip yinelemeyi alan düzeyinde işaretle.

**Yapılan düzeltme:** Same as F100. Duplicate emails are also caught on the client (normalized, error under the field, aria-invalid). — dosyalar: `src/components/cart/SplitPayPanel.tsx`

## F485 — Sepet, grup ödeme ve paylaşım sayfalarında site başlığı ve gezinme yok (diğer sayfalarla tutarsız; kaçış yolları dar)

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                             |
| Durum               | Gözlemlendi                                                                                        |
| Konum               | `src/app/cart/page.tsx:63`                                                                         |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx`, `src/app/pay/share/[token]/page.tsx`, `src/components/ui/ui.tsx` |
| Kullanıcılar        | misafir                                                                                            |
| Prensip             | learnability · Tutarlılık (Dix: consistency) / kullanıcı kontrolü                                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                        |
| Renk/tema           | Hayır                                                                                              |
| Efor                | S                                                                                                  |
| Kaynak denetçiler   | runtime:cart                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                       |

**Kanıt:** Sweep landmarks: 068/069 guest /cart ve 070/071 /checkout/cart için header=0, nav=0, footer=0. /trips, /plan ve /compare gibi oturumlu sayfalar PageShell kullandığından (ui.tsx:157-178) header=1, nav=1 ve footer=1. p8 (/pay/share/invalid-token, oturumlu görünüm): header=0, nav=0. Tab sırası (068) doğrudan kalem bağlantısıyla başlıyor. Çıkış yolları yalnızca kalem bağlantısı, 'Ödemeye geç' ve 'Sepeti boşalt'. /checkout/cart'ta tutmadan sonra 'Sepete dön' de kayboluyor (satır 279 yalnızca !held koşulunda). Ekran görüntüleri: full/shots/068-guest-tr-desktop-_cart.png ve 071-guest-tr-mobile-_checkout_cart.png

**Etki:** Misafir sepetten aramaya, seyahatlerine ya da hesabına dönemiyor; tarayıcı geri tuşuna mahkûm kalıyor. Header'daki sepet bağlantısı sepet sayfasının kendisinde yok. Davetle gelen katılımcı nerede olduğunu ve hangi hesapla giriş yaptığını göremiyor.

**Önerilen aksiyon:** cart/page.tsx ve pay/share sayfasını PageShell (Header+Footer) ile sar. checkout/cart için en az logo ve 'Sepete dön' içeren sadeleştirilmiş bir checkout başlığı kullan (dikkat dağıtmadan çıkış yolu). Paylaşım sayfasında başlıkta oturumdaki hesabı göster.

## F486 — Kabuksuz rotalar: oturumlu /cart, /checkout ve /checkout/cart sayfalarında başlık ve footer yok; geri dönüş yolu yok

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Medium                                                                |
| Durum               | Gözlemlendi                                                           |
| Konum               | `src/app/cart/page.tsx:63`                                            |
| Diğer konumlar      | `src/app/checkout/page.tsx:166`, `src/app/checkout/cart/page.tsx:232` |
| Kullanıcılar        | misafir                                                               |
| Prensip             | learnability · Consistency                                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                           |
| Renk/tema           | Hayır                                                                 |
| Efor                | M                                                                     |
| Kaynak denetçiler   | runtime:shell                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                          |

**Kanıt:** report.json landmark verisi: guest /cart, anon ve guest /checkout, guest /checkout/cart için header=0, footer=0. Anon /cart ise kabuklu, yani aynı rota oturum durumuna göre farklı kabukla geliyor. P12: guest /cart'ta etkileşimler yalnız mülk bağlantısı, 'Ödemeye geç' ve 'Sepeti boşalt'. /checkout'ta yalnız 'Uygula' ve 'Rezervasyonu Tamamla': mülke ya da aramaya geri dönüş, logo, hesap ve çıkış yok. Başlık nav'ındaki 'Sepetim'e tıklanınca başlık kayboluyor (RT/probes/shell/dbg2.png).

**Etki:** Kullanıcı sepetten ya da ödeme adımından alışverişe veya mülk sayfasına ancak tarayıcının geri tuşuyla dönebiliyor. Başlığın birden kaybolması yön duygusunu bozuyor.

**Önerilen aksiyon:** /cart sayfasını PageShell içine alın. Checkout'ta odaklı ama minimal bir kabuk kullanın: logo (/), '← Konaklamaya dön' (propertyId ile), adım göstergesi ve footer'da en azından yasal bağlantılar.

## F487 — Boş sepet ekranındaki 'Süresi dolan sepeti geri yükle' düğmesi elle boşaltılan sepette ve hiç sepeti olmayan kullanıcıda da çıkıyor; tıklayınca hiçbir şey olmuyor

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Medium                                                                |
| Durum               | Gözlemlendi                                                           |
| Konum               | `src/app/cart/page.tsx:82`                                            |
| Diğer konumlar      | `src/lib/cart/cart-service.ts`                                        |
| Kullanıcılar        | misafir                                                               |
| Prensip             | learnability · Öngörülebilirlik (Dix: predictability) / geri bildirim |
| Sezgisel madde      | H12 — Feedback                                                        |
| Renk/tema           | Hayır                                                                 |
| Efor                | S                                                                     |
| Kaynak denetçiler   | runtime:cart                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                          |

**Kanıt:** p2-empty (desktop TR): 'Sepeti boşalt' onaylandı (DELETE /api/cart/c1). Boş ekranda 'Konaklama ara' ile birlikte 'Süresi dolan sepeti geri yükle' (220x38) görünüyor. Tıklandı, POST /api/cart/reopen gitti, sunucu {cart:null} döndü. Ekran değişmedi, mesaj yok, odak body'de (C satırı). Sunucuda reopenCart yalnızca EXPIRED sepetleri geri yüklüyor (cart-service.ts:811-816), CANCELLED olanları değil. p11-nocart (mobil TR): GET {cart:null} dönen, hiç sepeti olmamış kullanıcıda da aynı düğme çıkıyor. Ekran görüntüsü: crops/cart/p2-desktop-tr-empty-after-clear.png ve crops/cart/p11-mobile-tr.png

**Etki:** Düğme var olmayan bir sepeti vaat ediyor. İşe yaramayınca kullanıcı sistemin bozuk olduğunu düşünüyor; elle boşalttığı sepeti 'geri yükleyebileceğini' sanıyor ama bu mümkün değil.

**Önerilen aksiyon:** Düğmeyi yalnızca geri yüklenebilir bir EXPIRED sepet varken göster: GET /api/cart yanıtına 'restorable: true/false' ekle. reopen null dönerse 'Geri yüklenecek sepet bulunamadı' durum mesajı göster. Elle boşaltma için ayrı bir 'Geri al' (undo) düşün.

## F488 — Sepet kalemi kaldırma: onay yok, geri alma yok, görünür geri bildirim yok

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Gözlemlendi                                          |
| Konum               | `src/app/cart/page.tsx:183`                          |
| Kullanıcılar        | misafir                                              |
| Prensip             | robustness · Kurtarılabilirlik (Dix: recoverability) |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                    |
| Renk/tema           | Hayır                                                |
| Efor                | M                                                    |
| Kaynak denetçiler   | runtime:cart                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** p1-remove (desktop TR, API stub, 400 ms gecikme): 'Kaldır' tetiklenince dialogs=[] ve DELETE /api/cart/items/it2 hemen gidiyor. İstek sürerken 3 düğme ve 6 alan disabled oluyor, ama 'kaldırılıyor…' gibi bir metin görünmüyor. Kaldırmadan sonra 'Geri al' düğmesi sayısı 0, kalem sessizce kayboluyor. Ekran görüntüleri: crops/cart/p1-desktop-tr-before.png ve p1-desktop-tr-after-remove.png. Kaldırma yolu remove() satır 39-40'ta, düğme 183-191'de.

**Etki:** Yanlış dokunuşla silinen kalemi geri getirmek için ilan sayfasına dönüp tarih, oda ve kişi seçimini baştan yapmak gerekiyor. Mobilde 'Kaldır' fiyat ve alanların hemen yanında durduğu için bu risk artıyor.

**Önerilen aksiyon:** Kaldırmadan sonra satırın yerinde birkaç saniye kalan bir 'X kaldırıldı — Geri al' satırı ya da toast göster. Geri al, aynı kalemi POST /api/cart/items ile yeniden eklesin (propertyId, roomTypeId, tarihler ve kişi sayıları istemcide zaten var). İşlem sürerken satır içinde 'Kaldırılıyor…' durumunu göster.

## F489 — Tutma başarısız olunca ('odalardan biri müsait değil') hangi odanın sorunlu olduğu gösterilmiyor ve doğrudan bir çözüm eylemi yok

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/app/checkout/cart/page.tsx:45`               |
| Kullanıcılar        | misafir                                           |
| Prensip             | robustness · Hata mesajları / ileri hata kurtarma |
| Sezgisel madde      | H9 — Hata mesajları                               |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | runtime:cart                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** p12-holdfail (desktop TR): hold 409 ve details.itemId='it2' döndü. Alert: 'Sepetteki odalardan biri artık müsait değil; hiçbir oda tutulmadı.' Satırlarda işaret yok (aria-invalid=null, sınıf aynı), odak body'de. Mevcut eylemler yalnızca ['Odaları tut','Sepete dön']. holdError details.itemId'yi yalnızca mesaj seçmek için kullanıyor (satır 48-49), kalemi işaretlemiyor. Ekran görüntüsü: crops/cart/p12-desktop-tr.png

**Etki:** Çok kalemli sepette kullanıcı hangi odayı kaldırması ya da değiştirmesi gerektiğini tahmin etmek zorunda kalıyor. Aynı düğmeye tekrar basmak aynı hatayı veriyor.

**Önerilen aksiyon:** details.itemId ile ilgili satırı vurgula ve satıra 'Bu oda artık müsait değil' notu ekle. Mesajı 'Kapadokya Mağara Otel · Deluxe Oda artık müsait değil' biçiminde adla yaz. Satıra 'Sepetten kaldır' veya 'Başka tarih/oda seç (ilana git)' eylemi koy.

## F490 — Bölünmüş ödeme seçeneği ancak 'Odaları tut' adımından sonra, ödeme formunun altında ve ekran dışında beliriyor; 'Ödemeye geç' bir tutma adımına götürüyor

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | Medium                                                               |
| Durum               | Gözlemlendi                                                          |
| Konum               | `src/app/checkout/cart/page.tsx:267`                                 |
| Diğer konumlar      | `src/app/cart/page.tsx`, `messages/tr/cart.json`                     |
| Kullanıcılar        | misafir                                                              |
| Prensip             | learnability · Feedforward / keşfedilebilirlik (Dix: predictability) |
| Sezgisel madde      | H13 — Feedforward                                                    |
| Renk/tema           | Hayır                                                                |
| Efor                | M                                                                    |
| Kaynak denetçiler   | runtime:cart                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                         |

**Kanıt:** /cart sayfasında CTA 'Ödemeye geç' (cart/page.tsx:216-221). Ama /checkout/cart'ta kart formu yok, yalnızca 'Odaları tut' var (sweep 070/071 bodyTextSample). Bölüşme paneli ancak held=true olunca render ediliyor (satır 359-367). p5: panel üst kenarı y=821, desktop viewport 800 (doc 1342). Mobilde y=929, viewport 844 (doc 1510). Panel 'Öde ve onayla' ve 'Tutmayı bırak' düğmelerinin altında. İki alternatifi ayıran 'ya da' ayracı yok; cart.split.or anahtarı ('ya da', cart.json:101) tanımlı ama kullanılmıyor (Grep sonucu yok). Ekran görüntüsü: crops/cart/p4d-0.png

**Etki:** Grupla ödemek isteyen kullanıcı bu seçeneği sepette veya tutma öncesinde göremiyor. Tek ödeme formunu tek yol sanıp tüm tutarı kendi kartıyla ödeyebilir. 'Ödemeye geç' sonrasında beklenmeyen bir ara adım çıkıyor.

**Önerilen aksiyon:** /cart toplam kutusunda 'Tek kartla öde' ve 'Grupla bölüş' seçeneklerini önden göster (ör. iki radyo veya iki CTA). Checkout'ta tuttuktan sonra iki yolu sekme ya da 'ya da' ayracıyla eş düzeyde sun; bölüşme seçeneğini kart formunun üstüne kısa bir özetle taşı. 'Ödemeye geç' metnini 'Odaları tut ve öde' olarak netleştir veya tutma adımını açıklayan bir adım göstergesi (1 Tut → 2 Öde) ekle.

## F491 — Geçersiz veya başkasına ait paylaşım linki ekranı neden ve sonraki adım vermiyor; tek bağlantı ilgisiz 'Seyahatlerim'

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Medium                                   |
| Durum               | Gözlemlendi                              |
| Konum               | `src/app/pay/share/[token]/page.tsx:155` |
| Kullanıcılar        | misafir                                  |
| Prensip             | robustness · Hata mesajları / yardım     |
| Sezgisel madde      | H9 — Hata mesajları                      |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | runtime:cart                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**             |

**Kanıt:** p8-share-invalid (oturumlu görünüm, API 404 SHARE_LINK_INVALID stub): desktop TR, mobil 390 ve EN çalıştırıldı. İçerik yalnızca H1 'Grup rezervasyonu payı', alert 'Bu ödeme linki geçersiz.' / 'This payment link is invalid.' ve 'Seyahatlerim' (/trips, 91x24) bağlantısı. Header, nav ve footer sayısı 0; odak body'de. SHARE_EMAIL_MISMATCH için metin 'Bu ödeme linki başka bir kişiye gönderildi.' (cart.json:107); hangi hesapla giriş yapıldığı ya da hesap değiştirme yolu gösterilmiyor. Ekran görüntüleri: crops/cart/p8-mobile-tr-SHARE_LINK_INVALID.png ve p8-desktop-en-SHARE_LINK_INVALID.png

**Etki:** Davet edilen kişi linkin neden çalışmadığını (yanlış kopyalama, süre dolması, yanlış hesap) ve ne yapması gerektiğini bilemiyor. 'Seyahatlerim' ona hiçbir şey ifade etmiyor; organizatöre ulaşma yolu yok.

**Önerilen aksiyon:** Hata koduna göre eylemli metin göster. INVALID için 'Linki eksiksiz kopyaladığınızdan emin olun ya da organizatörden yeni link isteyin'. MISMATCH için '<oturumdaki e-posta> ile giriş yaptınız; davet <maskeli e-posta> için. Çıkış yapıp doğru hesapla girin' ve [Hesap değiştir] düğmesi. Sayfayı PageShell ile sar ve 'Ana sayfa' bağlantısı ekle.

## F492 — Eşit bölmede organizatör örtük olarak sayıya dahil; varsayılan 2 satır 3 kişilik bölme yapıyor ve bu açıkça söylenmiyor

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | Medium                                                   |
| Durum               | Gözlemlendi                                              |
| Konum               | `src/components/cart/SplitPayPanel.tsx:59`               |
| Kullanıcılar        | misafir                                                  |
| Prensip             | learnability · Gerçek dünya eşleşmesi / öngörülebilirlik |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                              |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | runtime:cart                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                             |

**Kanıt:** p5 (desktop TR, toplam ₺7.458,18): form iki katılımcı satırıyla açılıyor (satır 59-62). Her satırda '₺2.486,06', 'Sizin payınız ₺2.486,06'; yani toplam 3'e bölünüyor (satır 94: rows.length + 1). Giriş metni 'Her katılımcı kendi payını kendi kartıyla öder…' (cart.json:57) kişi sayısını ya da organizatörün dahil olduğunu söylemiyor. 9 satıra ulaşılınca '+ Katılımcı ekle' kayboluyor ve 'en fazla' ipucu yok (any max hint? null; satır 243).

**Etki:** İki kişi (kendisi ve bir arkadaşı) bölüşmek isteyen kullanıcı varsayılan formu gönderince toplamı üçe bölmüş oluyor; boş e-postalı fazladan bir pay oluşuyor ve süre sonunda bu pay ona düşüyor.

**Önerilen aksiyon:** Formu 'Kaç kişi ödeyecek? (siz dahil) [2]' sayacıyla başlat ve varsayılanı 1 katılımcı yap. Özet satırı 'Toplam ₺7.458,18 ÷ 3 kişi = kişi başı ₺2.486,06 (siz dahil)' olsun. Sınıra yaklaşınca 'En fazla 9 katılımcı (siz dahil 10 kişi)' ipucunu göster.

## F493 — 'Linki kopyala' geri bildirimi düğmeden uzakta, hangi satıra ait olduğu belirsiz, kalıcı ve ikinci kopyalamada duyurulmuyor; izin yoksa ham window.prompt açılıyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/components/cart/SplitPayPanel.tsx:132`     |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · Geri bildirim / gözlemlenebilirlik |
| Sezgisel madde      | H12 — Feedback                                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | runtime:cart                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** p6-split-status (desktop TR, panoya izin verildi): Katılımcı 1'in 'Linki kopyala' düğmesi y=651'de, 'Kopyalandı' metni ise panelin en altında y=788'de (137 px aşağıda) çıktı. Düğme etiketi değişmedi. 4 sn sonra metin hâlâ duruyordu, hiç temizlenmiyor. Katılımcı 2'nin linki kopyalanınca metin yine 'Kopyalandı' kaldı; aria-live içeriği değişmediği için yeniden duyurulmuyor. Pano içeriği doğru (tok-1, sonra tok-2). İzin yokken (noclip) dialog 'prompt: Linki kopyala [default=http://localhost:3000/pay/share/tok-1]' açıldı ve uygulama içi bir mesaj yok. İlgili kod: notice satır 136/170, prompt fallback satır 138.

**Etki:** Organizatör hangi katılımcının linkini kopyaladığından emin olamıyor; yanlış kişiye yanlış link gönderebilir. Ekran okuyucu ikinci kopyalamada hiçbir şey duymuyor.

**Önerilen aksiyon:** Geri bildirimi satır içinde ver: düğme etiketi 2 sn için 'Kopyalandı ✓' olsun ve aria-live ile 'Katılımcı 1 linki kopyalandı' duyurulsun. Bildirim zaman aşımıyla temizlensin. Fallback için prompt yerine satır içinde seçili, salt-okunur bir link alanı göster.

## F590 — Bölme yöntemi radyo grubunda legend yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday (2 kaynak birleşti)                    |
| Konum               | `src/components/cart/SplitPayPanel.tsx:186` |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:235` |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · Info and Relationships      |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 1.3.1                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:cart, lens:a11y                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** 186-198 `<fieldset className="flex flex-wrap gap-4 ...">` içinde `<legend>` yok; radyolar `name="split-mode"` ('Eşit böl' / 'Özel tutarlar').

**Etki:** Ekran okuyucu grubu adsız okur ('Eşit böl, radyo düğmesi, 1/2'); seçimin neyi belirlediği (bölme yöntemi) duyurulmaz.

**Önerilen aksiyon:** `<legend className="text-sm font-medium text-gray-700">{t("modeLegend")}</legend>` ('Tutar nasıl bölünsün?') ekle; cart.json'a modeLegend anahtarını TR/EN ekle.

## F716 — Sepet güncellemesinde ilerleme ve sonuç (yeni fiyat/toplam) bildirilmiyor; hata metni sayfa başında kalıyor

| Alan                | Değer                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                           |
| Durum               | Aday                                                                                                                             |
| Konum               | `src/app/cart/page.tsx:22`                                                                                                       |
| Diğer konumlar      | `src/app/cart/page.tsx:65-69`, `src/app/cart/page.tsx:133-135`, `src/app/cart/page.tsx:210-212`, `src/app/cart/page.tsx:216-221` |
| Kullanıcılar        | misafir                                                                                                                          |
| Prensip             | robustness · observability                                                                                                       |
| Sezgisel madde      | H12 — Feedback                                                                                                                   |
| WCAG                | 4.1.3                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                            |
| Efor                | S                                                                                                                                |
| Kaynak denetçiler   | area:cart                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                     |

**Kanıt:** mutate() (22-33) yalnız setBusy(true); görünür 'Güncelleniyor…' yok. Yeni kalem fiyatı `f.money(item.totalMinor, cart.currency)` (133-135) ve toplam `data-testid="cart-total"` (210-212) canlı bölgede değil. Hata kutusu sayfa başında (65-69), düzenlenen kalemden uzak. 'Ödemeye geç' Link'i (216-221) busy iken de etkin.

**Etki:** Oda adedini değiştiren misafir toplamın değiştiğini kaçırabilir (ekran okuyucu hiç duymaz); mobilde aşağıdaki kalemi düzenlerken üstteki hatayı görmez; PATCH bitmeden 'Ödemeye geç'e basınca checkout eski toplamla açılabilir.

**Önerilen aksiyon:** Sayfaya kalıcı `<p role="status" aria-live="polite" className="sr-only">` ekle; başarıda "{property}: {n} oda — yeni toplam {total}" yaz. Kalem kartına aria-busy={pending} ve görünür 'Güncelleniyor…' metni. Hataları ilgili kalemin içinde de göster. Busy iken 'Ödemeye geç'i aria-disabled yap ve tıklamayı engelle.

## F717 — Sepet, checkout ve pay sayfalarında genel gezinme ve dil değiştirici yok

| Alan                | Değer                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                     |
| Konum               | `src/app/cart/page.tsx:63`                                                                                                                                                                               |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:232`, `src/app/pay/share/[token]/page.tsx:178`, `src/app/pay/share/[token]/page.tsx:162-164`, `src/components/layout/Header.tsx:101`, `src/components/ui/ui.tsx:157-179` |
| Kullanıcılar        | misafir                                                                                                                                                                                                  |
| Prensip             | flexibility · dialog initiative / customizability (dil)                                                                                                                                                  |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                                        |
| Kaynak denetçiler   | area:cart                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                             |

**Kanıt:** Sayfalar doğrudan `<main id="main">` döndürüyor (cart 63, checkout/cart 232, share 178). LocaleSwitcher içeren Header (Header.tsx:8, 101) ve PageShell (ui.tsx:157-179) kullanılmıyor. Share sayfasında tek çıkış 'Seyahatlerim' (162-164); organizatör kendi payını ödeyince checkout'taki durum ekranına dönüş bağlantısı yok.

**Etki:** E-posta linkiyle gelen EN konuşan katılımcı dili değiştiremez; misafir sepetten ana sayfaya/hesabına dönmek için tarayıcı geri tuşuna mecbur; organizatör pay durumuna geri dönemez.

**Önerilen aksiyon:** /cart'ı PageShell ile sar (Header + Footer). Checkout ve share için sade üst bar: logo → '/', LocaleSwitcher, 'Sepete dön'. Share sayfasında `share.isOrganizer` ise 'Bölünmüş ödeme durumuna dön' (/checkout/cart) bağlantısı.

## F718 — Sepet, ödeme ve paylaşımlı ödeme sayfalarında site başlığı/navigasyon yok

| Alan                | Değer                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                          |
| Durum               | Aday                                                                                                            |
| Konum               | `src/app/cart/page.tsx:63`                                                                                      |
| Diğer konumlar      | `src/app/checkout/page.tsx:166`, `src/app/checkout/cart/page.tsx:232`, `src/app/pay/share/[token]/page.tsx:178` |
| Kullanıcılar        | misafir                                                                                                         |
| Prensip             | learnability · consistency                                                                                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                               |
| WCAG                | 3.2.3                                                                                                           |
| Renk/tema           | Hayır                                                                                                           |
| Efor                | S                                                                                                               |
| Kaynak denetçiler   | lens:a11y                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                    |

**Kanıt:** cart/page.tsx:62-63 `return (<main id="main" className="mx-auto max-w-3xl px-4 py-8">` — Header/Footer yok, oysa 'Sepetim' Header.tsx:24'te ana menü öğesi; checkout/page.tsx:165-166, checkout/cart/page.tsx:231-232 ve pay/share/[token]/page.tsx:177-178 aynı. Diğer sayfalar PageShell veya Header+Footer kullanıyor.

**Etki:** Misafir menüden 'Sepetim'e geçince banner landmark'ı, ana menü, dil ve tema seçimi kayboluyor; ekran okuyucu landmark gezinmesiyle siteye dönemiyor; EN kullanıcı ödeme ortasında dili değiştiremiyor.

**Önerilen aksiyon:** Bu sayfaları PageShell ile sarın ya da tutarlı bir 'checkout header' (logo, 'Sepete dön', dil seçici, aynı skip link hedefi) kullanın.

## F719 — Sepet yüklenemediğinde 'Sepetiniz boş' gösteriliyor, yeniden deneme yok

| Alan                | Değer                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                          |
| Durum               | Aday                                                                                                            |
| Konum               | `src/app/cart/page.tsx:65`                                                                                      |
| Diğer konumlar      | `src/components/cart/useCart.ts`, `src/app/checkout/cart/page.tsx:31`, `src/app/checkout/cart/page.tsx:215-224` |
| Kullanıcılar        | misafir                                                                                                         |
| Prensip             | robustness · recoverability                                                                                     |
| Sezgisel madde      | H9 — Hata mesajları                                                                                             |
| Renk/tema           | Hayır                                                                                                           |
| Efor                | S                                                                                                               |
| Kaynak denetçiler   | area:cart                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                    |

**Kanıt:** useCart hata durumunda cart null kalır (useCart.ts reload catch → setError). Sayfa hem 65-69 `{message ?? t("loadFailed")}` uyarısını hem 71 `!cart` boş durumunu ("Sepetiniz boş" + 'Süresi dolan sepeti geri yükle') birlikte gösterir; 'Tekrar dene' yok. checkout/cart/page.tsx:31 `const { cart, setCart, loading, reload } = useCart();` error'ı almaz → ağ hatasında 215-224 "Ödenecek sepet yok." gösterir.

**Etki:** Ağ kesintisinde misafir sepetinin silindiğini düşünür; yeniden sepet kurmaya ya da yanlış 'geri yükle' eylemine yönelir.

**Önerilen aksiyon:** `error && !cart` için ayrı hata durumu: h1 + "Sepet yüklenemedi. Bağlantınızı kontrol edin." + `<button onClick={reload}>Tekrar dene</button>`; boş durumu yalnız !error iken göster. Checkout sayfasında da error'u al ve aynı hata durumunu kullan.

## F720 — Yükleme, hata ve boş durumları birbirine karışıyor (hata + 'boş', hata sonrası sonsuz 'Yükleniyor', yüklenirken 'kayıt yok')

| Alan                | Değer                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                  |
| Konum               | `src/app/cart/page.tsx:65`                                                                                                                                                                            |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:117`, `src/components/account/SessionManager.tsx:105`, `src/components/compliance/ComplianceDashboard.tsx:151`, `src/components/cart/SplitPayPanel.tsx:82` |
| Kullanıcılar        | tümü                                                                                                                                                                                                  |
| Prensip             | robustness · observability                                                                                                                                                                            |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                 |
| Efor                | S                                                                                                                                                                                                     |
| Kaynak denetçiler   | lens:status                                                                                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                          |

**Kanıt:** cart/page.tsx:65-74 yükleme hatasında 'Sepet yüklenemedi' ile aynı anda 'Sepetiniz boş' + 'Süresi dolan sepeti geri yükle' butonu. PasskeyManager.tsx:63 hata yazılıyor ama 117 `passkeys === null ?` → 'Yükleniyor...' kalıcı; SessionManager.tsx:63 ve 105 aynı. ComplianceDashboard.tsx:103 `const pending = notices.data ?? []` → 151 yükleme ve hata sırasında 'Bekleyen bildirim yok'. SplitPayPanel.tsx:82-83 plan okunamazsa `apply(null)` → mevcut plan varken 'Payları oluştur' formu.

**Etki:** Misafir sepetinin silindiğini sanıp 'geri yükle'ye basıyor; yönetici yasal süreli bildirim kuyruğunu boş sanıyor; organizatör var olan bölünmüş ödeme planının üzerine yenisini kurmaya çalışıyor.

**Önerilen aksiyon:** Her ekranda tek durum makinesi `loading | error | empty | ready`; hata varken boş durum ve 'Yükleniyor' render edilmesin. ComplianceDashboard'da `notices.data === null` için 'Yükleniyor…', hata için LoadError+retry. SplitPayPanel'de load hatasında create formu yerine 'Ödeme planı okunamadı — Tekrar dene'.

## F721 — 'Süresi dolan sepeti geri yükle' herkese gösteriliyor ve sonuç olmadığında sessiz kalıyor

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Medium                                 |
| Durum               | Aday                                   |
| Konum               | `src/app/cart/page.tsx:82`             |
| Diğer konumlar      | `src/lib/cart/cart-service.ts:808-816` |
| Kullanıcılar        | misafir                                |
| Prensip             | learnability · predictability          |
| Sezgisel madde      | H13 — Feedforward                      |
| Renk/tema           | Hayır                                  |
| Efor                | M                                      |
| Kaynak denetçiler   | area:cart                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** 82-91 `{!cart && (<button ... onClick={reopen}>{t("reopen")}</button>)}`: hiç sepeti olmamış, yeni ödeme yapmış (CHECKED_OUT) veya sepetini elle iptal etmiş kullanıcıya da görünür. reopenCart yalnız EXPIRED sepet arar (cart-service.ts:811-816), yoksa null döner → setCart(null) → ekran değişmez, mesaj yok. Elle iptal sonrası daha eski, ilgisiz bir EXPIRED sepeti geri getirebilir.

**Etki:** Düğmeye basan misafir hiçbir şey olmadığını görür (sistemi bozuk sanır) ya da beklemediği eski bir sepet geri gelir.

**Önerilen aksiyon:** GET /api/cart yanıtına `restorable: { expiredAt, itemCount } | null` ekle; düğmeyi yalnız bu varken "{date} tarihinde süresi dolan {n} odalı sepeti geri yükle" metniyle göster. Null dönerse role="status" ile "Geri yüklenecek sepet bulunamadı".

## F722 — Başlık hiyerarşisi eksik: kalemler, toplam, boş/yükleme/hata durumları

| Alan                | Değer                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                  |
| Durum               | Aday                                                                                                                                                                                                                                    |
| Konum               | `src/app/cart/page.tsx:118`                                                                                                                                                                                                             |
| Diğer konumlar      | `src/app/cart/page.tsx:73`, `src/app/cart/page.tsx:209`, `src/app/checkout/cart/page.tsx:168-174`, `src/app/checkout/cart/page.tsx:215-224`, `src/app/pay/share/[token]/page.tsx:168-174`, `src/app/pay/share/[token]/page.tsx:184-208` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                 |
| Prensip             | accessibility · Info and Relationships                                                                                                                                                                                                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                   |
| WCAG                | 1.3.1                                                                                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | area:cart                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                            |

**Kanıt:** Kalem adı `<Link className="font-semibold text-gray-900">` (118-123) başlık değil; 'Sepet toplamı' `<span className="text-lg font-semibold">` (209); boş durum `<p className="text-lg font-semibold">{t("empty")}</p>` (73). Yükleme dallarında h1 yok (cart 52-58, checkout/cart 168-174, share 168-174); checkout noCart dalında (215-224) h1 yok; share özet bölümü başlıksız (184-208).

**Etki:** Ekran okuyucu kullanıcısı başlıkla gezinerek kalemler arasında atlayamaz ve karşılaştıramaz; yükleme/boş ekranlarında sayfanın ne olduğunu başlıktan öğrenemez.

**Önerilen aksiyon:** Kalem adını `<h2>` içine al (bağlantı h2 içinde); 'Sepet toplamı' ve boş durum metnini `<h2>` yap; tüm yükleme/boş/hata dallarında aynı `<h1>`'i render et; share özetine `<h2>{t("share.summary")}</h2>`.

## F723 — Tekrarlanan kontrollerin erişilebilir adlarında satır bağlamı yok

| Alan                | Değer                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                                     |
| Konum               | `src/app/cart/page.tsx:138`                                                                                                                                                                                              |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:235`, `src/components/cart/SplitPayPanel.tsx:336`, `src/components/cart/SplitPayPanel.tsx:341`, `src/components/cart/SplitPayPanel.tsx:354`, `src/app/checkout/cart/page.tsx:199` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                  |
| Prensip             | accessibility · Headings and Labels                                                                                                                                                                                      |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                    |
| WCAG                | 2.4.6                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                    |
| Efor                | S                                                                                                                                                                                                                        |
| Kaynak denetçiler   | area:cart                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                             |

**Kanıt:** Her kalemde `<label>{t("item.adults")}<input .../></label>` (138-152), 'Çocuk' (153-167), 'Oda adedi' (168-182): kalem adı yok. SplitPayPanel.tsx:235 `aria-label={t("removeParticipant")}` (numarasız 'Katılımcıyı kaldır'), 336 'Linki kopyala', 341 `aria-label={t("emailLabel")}`, 354 'E-postayla gönder' her satırda aynı. Başarı ekranında her satırda 'Rezervasyonu görüntüle' (checkout/cart/page.tsx:199).

**Etki:** Ekran okuyucu kontrol listesinde 3 kez 'Yetişkin, 2', 2 kez 'Linki kopyala' duyulur; yanlış kalem düzenlenir veya link yanlış kişiye gönderilir.

**Önerilen aksiyon:** Kalem kartını `<fieldset aria-labelledby={titleId}>` ile grupla (başlık bağlantısına id). Split satırlarında `aria-label={t("removeParticipantN", { n: i + 1 })}`, kopyala/gönder/e-posta için `aria-describedby={rowNameId}`. Başarı listesinde bağlantıya satır metnini aria-describedby ile bağla.

## F724 — Sepet: başarısız güncellemeden sonra kişi alanı sunucu değerini değil reddedilen değeri gösteriyor; toplam değişimi duyurulmuyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Aday                                                    |
| Konum               | `src/app/cart/page.tsx:145`                             |
| Diğer konumlar      | `src/app/cart/page.tsx:26`, `src/app/cart/page.tsx:210` |
| Kullanıcılar        | misafir                                                 |
| Prensip             | robustness · observability                              |
| Sezgisel madde      | H12 — Feedback                                          |
| WCAG                | 4.1.3                                                   |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | lens:status                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** cart/page.tsx:145 `defaultValue={item.adults}` (kontrolsüz input), 147-150 onBlur ile PATCH; hata olursa 26-30 `setMessage(...)` + `await reload()` ama `key={item.id}` değişmediği için DOM'daki reddedilen değer kalıyor (çocuk alanı 160-165 aynı). 210-212 sepet toplamı ve 133-135 kalem tutarı canlı bölge değil; başarılı güncellemede geri bildirim yok.

**Etki:** Misafir 8 yetişkin yazıp hata aldığında alan 8 göstermeye devam ediyor, fiyat eski kişi sayısında kalıyor → yanlış kişi sayısıyla ödeme riski; ekran okuyucu yeni toplamı öğrenemiyor.

**Önerilen aksiyon:** Inputları kontrollü yap (yerel taslak + value) veya reload sonrası `key={`${item.id}-${item.adults}-${item.children}`}` ile yeniden mount et; hata mesajını ilgili kalemin altında aria-describedby ile bağla; toplam alanına `aria-live="polite"` ve 'Toplam güncellendi: 4.200 ₺' duyurusu.

## F725 — Sepette kişi sayısı blur'da kaydediliyor ve gösterge yok; akış boyunca 4 farklı misafir kontrolü var

| Alan                | Değer                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                            |
| Durum               | Aday                                                                                                                                                              |
| Konum               | `src/app/cart/page.tsx:147`                                                                                                                                       |
| Diğer konumlar      | `src/app/cart/page.tsx:217`, `src/components/search/SearchBar.tsx:151`, `src/components/booking/BookingWidget.tsx:166`, `src/components/plan/TripPlanner.tsx:129` |
| Kullanıcılar        | misafir                                                                                                                                                           |
| Prensip             | robustness · observability                                                                                                                                        |
| Sezgisel madde      | H12 — Feedback                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                             |
| Efor                | M                                                                                                                                                                 |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                      |

**Kanıt:** cart/page.tsx:140-166'daki `type="number"` alanlar (w-20, `px-2 py-1`) değeri `onBlur`'da PATCH ediyor. Alan bazında 'kaydediliyor' ya da 'kaydedildi' göstergesi yok. :217'deki 'Ödemeye geç' bağlantısı `busy` iken de etkin; mobilde alanı düzenleyip doğrudan bağlantıya dokunmak blur'daki PATCH ile sayfa geçişini yarıştırıyor. Misafir sayısı akış boyunca dört farklı kontrolle giriliyor: SearchBar.tsx:151-213 −/+ adımlayıcı, BookingWidget.tsx:166 select (1–6, çocuk yok), sepette number input ve TripPlanner.tsx:129 number input.

**Etki:** Misafir sepet toplamının güncellenip güncellenmediğini bilemiyor ve ödeme sayfası eski toplamla açılabiliyor. Her ekranda farklı bir kontrol öğrenme yükü getiriyor.

**Önerilen aksiyon:** Ortak bir `<GuestStepper>` bileşeni yaz: 44px'lik −/+ düğmeleri, anında PATCH ve satırda `aria-live` ile 'Güncellendi · yeni toplam ₺…'. busy iken 'Ödemeye geç'i `aria-disabled` yap. Aynı bileşeni BookingWidget'ta ve TripPlanner'da kullan.

## F726 — Kalem veya katılımcı satırı kaldırılınca odak kayboluyor, duyuru ve geri alma yok

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                       |
| Durum               | Aday                                                                                         |
| Konum               | `src/app/cart/page.tsx:183`                                                                  |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:230-238`, `src/components/cart/SplitPayPanel.tsx:201` |
| Kullanıcılar        | misafir                                                                                      |
| Prensip             | robustness · recoverability                                                                  |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                            |
| WCAG                | 2.4.3                                                                                        |
| Renk/tema           | Hayır                                                                                        |
| Efor                | M                                                                                            |
| Kaynak denetçiler   | area:cart                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                 |

**Kanıt:** 183-191 'Kaldır' → remove() → mutate → setCart; `<li key={item.id}>` ve odaktaki düğme DOM'dan çıkar; onay, role="status" veya 'Geri al' yok. SplitPayPanel.tsx:230-238 `onClick={() => setRows(rows.filter((_, j) => j !== i))}` aynı şekilde odağı düşürür; satırlar 201 `key={i}` indeks anahtarlı.

**Etki:** Klavye/ekran okuyucu kullanıcısı sayfadaki konumunu kaybeder. Yanlışlıkla kaldırılan oda (tarih + oda seçimi) ilan sayfasına dönüp yeniden seçilmeden geri gelmez.

**Önerilen aksiyon:** Kaldırma sonrası odağı bir sonraki kalemin başlık bağlantısına (yoksa 'Sepet toplamı' başlığına) taşı. role="status" ile "{name} sepetten kaldırıldı" + 8 sn 'Geri al' (aynı verilerle POST /api/cart/items). Katılımcı satırlarında kararlı id anahtarı; kaldırınca önceki satırın e-posta alanına odak.

## F727 — Son kullanma tarihi alanı '12/30' ile önceden dolu geliyor

| Alan                | Değer                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                          |
| Durum               | Aday                                                                                                                            |
| Konum               | `src/app/checkout/cart/page.tsx:36`                                                                                             |
| Diğer konumlar      | `src/app/pay/share/[token]/page.tsx:33`, `src/app/checkout/cart/page.tsx:311-317`, `src/app/pay/share/[token]/page.tsx:254-260` |
| Kullanıcılar        | misafir                                                                                                                         |
| Prensip             | robustness · recoverability (hata önleme)                                                                                       |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                |
| Renk/tema           | Hayır                                                                                                                           |
| Efor                | S                                                                                                                               |
| Kaynak denetçiler   | area:cart                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                    |

**Kanıt:** 36 `useState({ number: "", exp: "12/30", cvc: "" })`; share page:33 aynı. Alan (311-317) `autoComplete="cc-exp"` ama dolu değer tarayıcı otomatik doldurmasını bazı tarayıcılarda engeller. docs/img/v4-checkout-cart.png'de '12/30' görünüyor.

**Etki:** Kendi kartıyla ödeyen misafir dolu alanı kendi verisi sanıp kontrol etmez; reddedilen ödeme ve yeniden deneme.

**Önerilen aksiyon:** Varsayılanı boş bırak; placeholder="AA/YY", inputMode="numeric", maxLength={5} ekle ve '1230' girişini '12/30'a otomatik biçimle. Demo kolaylığı için test kartı metnine "Son kullanma: gelecekte herhangi bir tarih, ör. 12/30" yaz.

## F728 — Tutma hatası hangi odanın müsait olmadığını ve fiyatın ne kadar değiştiğini söylemiyor

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | Medium                                                                  |
| Durum               | Aday                                                                    |
| Konum               | `src/app/checkout/cart/page.tsx:49`                                     |
| Diğer konumlar      | `messages/tr/cart.json:42-43`, `src/app/checkout/cart/page.tsx:237-249` |
| Kullanıcılar        | misafir                                                                 |
| Prensip             | robustness · recoverability                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                     |
| WCAG                | 3.3.3                                                                   |
| Renk/tema           | Hayır                                                                   |
| Efor                | M                                                                       |
| Kaynak denetçiler   | area:cart                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                            |

**Kanıt:** 48-49 `const details = err.details as { itemId?: string } | undefined; if (err.status === 409 && details?.itemId) return t("checkout.itemUnavailable");`: itemId elde var ama metin "Sepetteki odalardan biri artık müsait değil; hiçbir oda tutulmadı." (tr cart.json:43). PRICE_CHANGED için "Fiyat değişti. Yeni toplamı kontrol edip tekrar deneyin." (tr:42); eski/yeni tutar veya değişen kalem gösterilmiyor, özet listesi (237-249) değişeni vurgulamıyor.

**Etki:** Birden çok odalı misafir hangi kalemi kaldıracağını tahmin etmek zorunda; fiyat farkını kendisi hesaplamalı (para toleransı çok düşük).

**Önerilen aksiyon:** itemId ile `cart.items.find(...)` → "{propertyTitle} – {roomTypeName} ({tarihler}) artık müsait değil. Bu odayı kaldırıp diğerlerini tutabilirsiniz." + `/cart#item-{id}` bağlantısı. PRICE_CHANGED'de önceki toplamı state'te tut, "Toplam {eski} → {yeni}" göster ve değişen satıra görünür 'Fiyat güncellendi' etiketi ekle.

## F729 — Sepet ödemesinde olumlu bilgi mesajı ('Ödemeniz alındı…') kırmızı hata kutusunda ve role=alert ile gösteriliyor

| Alan                | Değer                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                            |
| Durum               | Aday                                                                                                                              |
| Konum               | `src/app/checkout/cart/page.tsx:79`                                                                                               |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:259-265`, `src/components/booking/BookingActions.tsx:363-370`, `src/components/ui/ui.tsx:144-155` |
| Kullanıcılar        | misafir                                                                                                                           |
| Prensip             | robustness · observability / consistency                                                                                          |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                    |
| WCAG                | 4.1.3                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                             |
| Efor                | S                                                                                                                                 |
| Kaynak denetçiler   | lens:consistency                                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                      |

**Kanıt:** checkout/cart/page.tsx:79 `setMessage(t("checkout.confirmPending"))` (cart.json:47 "Ödemeniz alındı; rezervasyon onayı birkaç saniye içinde tamamlanacak…") ile hata mesajları aynı `message` durumunu paylaşıyor ve :261'de `<div role="alert" className="… bg-red-50 … text-red-700">` olarak gösteriliyor. Başka yerlerde başarı ve bilgi ayrı tutuluyor: BookingActions.tsx:363-368 `role={message.kind === "error" ? "alert" : "status"}`, AuthCard Notice `kind`, ui.tsx:144-155 Status error/message.

**Etki:** Ödemesi başarıyla alınan misafir kırmızı bir uyarı görür ve ekran okuyucu bunu acil hata olarak okur. Kullanıcı ödemenin başarısız olduğunu sanıp tekrar ödemeye çalışabilir. Bu, para hatası riski taşır.

**Önerilen aksiyon:** `message` durumunu `{ kind: "error" | "info", text }` yapısına çevirin ve gösterimde ui.tsx Status (error/message) ya da Notice kullanın. confirmPending `role="status"` ile ve 'yenile' düğmesiyle (reload) birlikte gösterilsin.

## F730 — Başarılı ödemeden sonraki sepet okuması hata verirse kullanıcıya 'Ödeme başarısız' deniyor

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Aday                                                                             |
| Konum               | `src/app/checkout/cart/page.tsx:83`                                              |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:119-127`, `src/app/checkout/cart/page.tsx:87-98` |
| Kullanıcılar        | misafir                                                                          |
| Prensip             | robustness · observability                                                       |
| Sezgisel madde      | H9 — Hata mesajları                                                              |
| Renk/tema           | Hayır                                                                            |
| Efor                | S                                                                                |
| Kaynak denetçiler   | area:cart                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                     |

**Kanıt:** finish() confirmed dalı: 83-84 `const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${outcome.cartId}`); setDone(...)`. finish pay() içindeki try'da çağrılıyor (119-127); bu GET ağ hatası verirse catch → payFailed(err) → `setMessage(err instanceof ApiError ? err.message : tp("failed"))` ("Ödeme başarısız") ve 96 `setPayKey(newKey())`.

**Etki:** Tahsilatı yapılmış misafire 'Ödeme başarısız' gösterilir; yeni idempotency anahtarıyla tekrar dener ve ham sunucu hatası alır. Güven kaybı ve destek talebi.

**Önerilen aksiyon:** Confirmed dalındaki GET'i ayrı try/catch'e al; başarısızsa done ekranını outcome verisiyle (amount, currency, bookingIds) göster, rezervasyon bağlantılarını bookingIds'ten `/booking/${id}` olarak üret. payFailed'i yalnız pay/confirm POST hatalarında çağır.

## F731 — Kart alanı hataları alana bağlanmıyor; biçim hatası 'süresi geçmiş' diye raporlanıyor

| Alan                | Değer                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                  |
| Konum               | `src/app/checkout/cart/page.tsx:106`                                                                                                                                                                                  |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:259-265`, `src/app/checkout/cart/page.tsx:389-396`, `src/app/pay/share/[token]/page.tsx:111-120`, `src/app/pay/share/[token]/page.tsx:240-273`, `src/lib/payment/card-token.ts:61-63` |
| Kullanıcılar        | misafir                                                                                                                                                                                                               |
| Prensip             | robustness · recoverability                                                                                                                                                                                           |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                   |
| WCAG                | 3.3.3                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                 |
| Efor                | M                                                                                                                                                                                                                     |
| Kaynak denetçiler   | area:cart                                                                                                                                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                          |

**Kanıt:** 106 `const [mm, yy] = card.exp.split("/").map((v) => Number(v.trim()));`: '1230' girilirse mm=1230 → tokenizeCard "Kartın son kullanma tarihi geçmiş" fırlatır (card-token.ts:61-63); '12/2030' → expYear 4030 kabul edilir. Hata sayfa üstündeki genel kutuda (259-265); input'larda aria-invalid/aria-describedby yok, odak alana taşınmaz. Kart numarasında maxLength/gruplama yok; CVC açıklanmıyor; 3DS kod alanında (389-396) maxLength/pattern yok. Share page:111-120 ve 240-273 aynı. ui.tsx'teki Field bileşeni (aria-describedby + aria-invalid) kullanılmıyor.

**Etki:** Biçimi yanlış giren misafir kartının süresi dolmuş sanır; ekran okuyucu kullanıcısı hatalı alanı bulmak için formu baştan gezmek zorunda kalır.

**Önerilen aksiyon:** ui.tsx Field bileşenini kullan. Doğrulamayı alan bazına böl: INVALID_EXPIRY_FORMAT → "AA/YY biçiminde girin, ör. 08/27"; ilk hatalı alana focus(). Kart numarasına maxLength={23} ve 4'lü gruplama; CVC'ye maxLength={4} + ipucu "Kartın arkasındaki 3 haneli kod"; 3DS alanına maxLength={6} pattern="\d{6}".

## F732 — Başarı ekranı kalıcı değil; split tamamlanınca organizatöre onay/rezervasyon bağlantısı gösterilmiyor

| Alan                | Değer                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                               |
| Durum               | Aday                                                                                                                 |
| Konum               | `src/app/checkout/cart/page.tsx:176`                                                                                 |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:215-224`, `src/app/cart/page.tsx:71-91`, `src/components/cart/SplitPayPanel.tsx:280` |
| Kullanıcılar        | misafir                                                                                                              |
| Prensip             | robustness · observability                                                                                           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                       |
| Renk/tema           | Hayır                                                                                                                |
| Efor                | M                                                                                                                    |
| Kaynak denetçiler   | area:cart                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                         |

**Kanıt:** Başarı yalnız istemci state'inde: 40-43 `const [done, setDone] = useState<...>(null)`; 176 `if (done)`. Yenileme/geri gelişte sepet CHECKED_OUT → 215-224 "Ödenecek sepet yok."; /cart'ta "Sepetiniz boş" + 'Süresi dolan sepeti geri yükle' (cart/page.tsx:71-91). Split'te tüm paylar gelince panel yalnız `t(`planStatus.${plan.status}`)` metnini gösterir (SplitPayPanel.tsx:280), yönlendirme/bağlantı yok. Başarı listesinde (185-204) rezervasyon numarası ve 'onay e-postası gönderildi' bilgisi yok.

**Etki:** Sekmeyi yenileyen veya sonra dönen misafir rezervasyonunun yapıldığını bu sayfalardan doğrulayamaz; split organizatörü işlemin tamamlandığını ve rezervasyon bağlantılarını görmez.

**Önerilen aksiyon:** Onaydan sonra kalıcı URL'ye yönlendir (ör. /checkout/cart/done?cart=<id>, GET /api/cart/:id ile render). noCart dalında son CHECKED_OUT sepet varsa "Bu sepet {date} tarihinde ödendi — Rezervasyonlarımı gör" göster. SETTLED planda panelde rezervasyon bağlantıları ve 'Seyahatlerim' düğmesi. Başarı satırlarına rezervasyon kodu ve 'Onay e-postası {email} adresine gönderildi' satırı.

## F733 — Ödeme öncesi özette misafir sayısı ve gece sayısı yok; tek oda checkout'uyla tutarsız düzen

| Alan                | Değer                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Severity            | Medium                                                                            |
| Durum               | Aday                                                                              |
| Konum               | `src/app/checkout/cart/page.tsx:241`                                              |
| Diğer konumlar      | `src/app/pay/share/[token]/page.tsx:186-191`, `src/app/checkout/page.tsx:172-202` |
| Kullanıcılar        | misafir                                                                           |
| Prensip             | robustness · task conformance                                                     |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                           |
| Renk/tema           | Hayır                                                                             |
| Efor                | S                                                                                 |
| Kaynak denetçiler   | area:cart                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                      |

**Kanıt:** 241-242 `{item.propertyTitle} · {item.roomTypeName} × {item.quantity} · {f.date(item.checkIn, "medium")} → {f.date(item.checkOut, "medium")}`: adults/children/nights yok, tek satır birleştirilmiş metin. Tek oda checkout'u aynı bilgiyi `<dl>` ile ve 'Misafir' satırıyla veriyor (src/app/checkout/page.tsx:172-202). Share page:186-191 da misafir/gece içermiyor.

**Etki:** Misafir ödeme anında yetişkin/çocuk sayısını doğrulayamaz; sepette yanlış kalan değer (bkz. kontrolsüz alan bulgusu) fark edilmeden ödenir.

**Önerilen aksiyon:** Her kalemi `<dl>` ile yapılandır: Tesis, Oda × adet ('2 oda'), Tarihler (n gece), Misafirler ('2 yetişkin, 1 çocuk'), Tutar; tek oda checkout'uyla aynı düzen ve sınıflar.

## F734 — İki aşamalı süreç (odaları tut → öde) önceden anlatılmıyor; adım göstergesi yok

| Alan                | Değer                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                  |
| Durum               | Aday                                                                                    |
| Konum               | `src/app/checkout/cart/page.tsx:267`                                                    |
| Diğer konumlar      | `src/app/cart/page.tsx:216-221`, `messages/tr/cart.json:11`, `messages/tr/cart.json:40` |
| Kullanıcılar        | misafir                                                                                 |
| Prensip             | learnability · predictability                                                           |
| Sezgisel madde      | H13 — Feedforward                                                                       |
| Renk/tema           | Hayır                                                                                   |
| Efor                | M                                                                                       |
| Kaynak denetçiler   | area:cart                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                            |

**Kanıt:** Sepetteki 'Ödemeye geç' (cart/page.tsx:216-221, tr:11) ödeme yerine 'Odaları tut' adımına götürüyor (267-283). holdHint "Ödemeden önce tüm odalar birlikte tutulur (tümü ya da hiçbiri)." (tr:40) tutmanın 15 dk sürdüğünü, bu adımda ücret alınmadığını ve ardından kart isteneceğini söylemiyor. Sayfada adım göstergesi yok.

**Etki:** Düşük okuryazarlıklı misafir 'Odaları tut'un ödeme olup olmadığını, para çekilip çekilmediğini bilmez; süreli olduğunu öğrenmeden başlatır.

**Önerilen aksiyon:** h1 altına `<ol aria-label="Adımlar">` göstergesi (1 Odaları ayırt · 2 Ödeme · 3 Onay; geçerli adımda aria-current="step"). holdHint → "Odaları 15 dakika sizin için ayırırız; bu adımda ücret alınmaz. Ardından kart bilgilerinizi girersiniz.". Sepetteki düğme → 'Rezervasyona devam et'.

## F735 — Doğrulanmış e-posta şartı (tutma ve bölme) eylemden önce belirtilmiyor

| Alan                | Değer                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                               |
| Durum               | Aday                                                                                                                                 |
| Konum               | `src/app/checkout/cart/page.tsx:270`                                                                                                 |
| Diğer konumlar      | `src/app/api/cart/[id]/hold/route.ts:15`, `src/app/api/cart/[id]/split/route.ts:24`, `src/components/cart/SplitPayPanel.tsx:174-268` |
| Kullanıcılar        | misafir                                                                                                                              |
| Prensip             | learnability · predictability                                                                                                        |
| Sezgisel madde      | H13 — Feedforward                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                |
| Efor                | M                                                                                                                                    |
| Kaynak denetçiler   | area:cart                                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                         |

**Kanıt:** 'Odaları tut' (270-278) koşulsuz etkin; sunucu `requireVerifiedEmail(req)` (src/app/api/cart/[id]/hold/route.ts:15) ile reddediyor ve holdError (45-51) bu kodu ele almadığından `err.message` ham gösteriliyor. Split oluşturma da `requireVerifiedEmail` (src/app/api/cart/[id]/split/route.ts:24) istiyor; form (SplitPayPanel.tsx:174-268) bunu söylemiyor.

**Etki:** E-postasını doğrulamamış misafir sepeti hazırlayıp formu doldurduktan sonra engellenir ve sonraki adımı bilmez.

**Önerilen aksiyon:** Sayfa yüklenirken oturumdaki emailVerified bilgisini al; doğrulanmamışsa 'Odaları tut' ve 'Payları oluştur' üstünde "Devam etmek için e-postanızı doğrulayın" kutusu + 'Doğrulama e-postası gönder' düğmesi; düğmeleri aria-disabled yap. EMAIL_NOT_VERIFIED kodunu çevrilmiş metne eşle.

## F736 — Tek ödeme ve grupla bölme formları seçim yapısı olmadan alt alta sunuluyor

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Medium                                                                |
| Durum               | Aday                                                                  |
| Konum               | `src/app/checkout/cart/page.tsx:359`                                  |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:285-357`, `messages/tr/cart.json:101` |
| Kullanıcılar        | misafir                                                               |
| Prensip             | learnability · predictability                                         |
| Sezgisel madde      | H13 — Feedforward                                                     |
| Renk/tema           | Hayır                                                                 |
| Efor                | M                                                                     |
| Kaynak denetçiler   | area:cart                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                          |

**Kanıt:** 285-357 ödeme formu ('Öde ve onayla · ₺9.794,92') ve hemen ardından 359-367 SplitPayPanel oluşturma formu ('Payları oluştur') aynı anda; araya 'Tutmayı bırak' (348-355) giriyor. messages/tr/cart.json:101 `"or": "ya da"` tanımlı ama hiçbir bileşende kullanılmıyor. docs/img/v4-checkout-cart.png'de split formu ekranın altında kalıyor.

**Etki:** Misafir iki formun birbirini dışladığını anlamaz; bölmek isterken kartını ilk forma girer ya da kıvrım altındaki split seçeneğini hiç görmez.

**Önerilen aksiyon:** Ödeme yöntemi seçimini başa al: `<fieldset><legend>Nasıl ödemek istersiniz?</legend>` + iki radyo ('Tamamını ben ödeyeceğim' / 'Grupla bölüşeceğiz') ve seçime göre ilgili formu göster. En azından iki form arasına `t("split.or")` ayırıcısı ve ödeme formunun başına split bölümüne atlayan bağlantı ekle.

## F737 — 3D Secure adımında vazgeçme / farklı kartla deneme yolu yok

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/app/checkout/cart/page.tsx:379`         |
| Diğer konumlar      | `src/app/pay/share/[token]/page.tsx:294-321` |
| Kullanıcılar        | misafir                                      |
| Prensip             | robustness · recoverability                  |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü            |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:cart                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** 379-406 3DS formunda yalnız 'Doğrula' gönder düğmesi var; setChallenge(null) yalnız başarı/hata sonrası çağrılıyor. Kart formu ve 'Tutmayı bırak' bu adımda gizli (285 ve 359 `!challenge`). Share page:294-321 aynı.

**Etki:** Kod gelmeyen veya yanlış kart girdiğini fark eden misafirin çıkış yolu yok; yalnız sayfayı yenilemek (sonucu belirsiz) kalıyor.

**Önerilen aksiyon:** 3DS formuna ikincil 'Farklı kartla dene' düğmesi (`setChallenge(null); setCode(""); setPayKey(newKey())`) ve 'Kod gelmedi mi?' yardım metni ekle; checkout'ta bu adımda da 'Tutmayı bırak' bağlantısını (onaylı) göster.

## F738 — Ödeme deneme sınırı önceden bildirilmiyor, kilitlenme mesajı çevrilmiyor

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | Medium                                                                          |
| Durum               | Aday                                                                            |
| Konum               | `src/app/pay/share/[token]/page.tsx:44`                                         |
| Diğer konumlar      | `src/lib/cart/split-payment.ts:622-633`, `src/app/checkout/cart/page.tsx:87-98` |
| Kullanıcılar        | misafir                                                                         |
| Prensip             | robustness · recoverability                                                     |
| Sezgisel madde      | H5 — Hata önleme                                                                |
| Renk/tema           | Hayır                                                                           |
| Efor                | M                                                                               |
| Kaynak denetçiler   | area:cart                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                    |

**Kanıt:** errorText switch'i (44-63) PAYMENT_ATTEMPTS_EXCEEDED'i ele almaz → `default: return err.message;` ham TR metin "Çok fazla başarısız ödeme denemesi. Bu pay için ödeme kapatıldı." (split-payment.ts:622-633). Kalan hak sayısı hiçbir yerde gösterilmiyor. Checkout payFailed (87-98) aynı.

**Etki:** Kartı reddedilen katılımcı birkaç denemeden sonra uyarısız kilitlenir ve ne yapacağını bilmez.

**Önerilen aksiyon:** Ret mesajına "Kalan deneme: {n}" ekle (sunucu details.attemptsLeft döndürsün); son hakta uyarı. PAYMENT_ATTEMPTS_EXCEEDED için çevrilmiş metin + "{minutes} dk sonra tekrar deneyin veya organizatörden yeni link isteyin".

## F739 — Pay linki hata durumlarında kurtarma eylemi sunulmuyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Medium                                   |
| Durum               | Aday                                     |
| Konum               | `src/app/pay/share/[token]/page.tsx:155` |
| Diğer konumlar      | `messages/tr/cart.json:105-108`          |
| Kullanıcılar        | misafir                                  |
| Prensip             | robustness · recoverability              |
| Sezgisel madde      | H9 — Hata mesajları                      |
| WCAG                | 3.3.3                                    |
| Renk/tema           | Hayır                                    |
| Efor                | M                                        |
| Kaynak denetçiler   | area:cart                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**             |

**Kanıt:** 155-167 loadError dalı yalnız hata metni + 'Seyahatlerim' bağlantısı. "Bu ödeme linki başka bir kişiye gönderildi." (tr cart.json:107) hesap değiştirme yolu sunmaz; "Ödeme yapmak için e-posta adresinizi doğrulayın." (tr:108) için doğrulama e-postasını yeniden gönderme düğmesi yok; expired/invalid (tr:105-106) organizatörden yeni link istemeyi önermez.

**Etki:** Yanlış hesapla girmiş veya e-postası doğrulanmamış katılımcı ödemeyi tamamlayamaz ve ne yapacağını bilemez.

**Önerilen aksiyon:** Koda göre eylem: SHARE_EMAIL_MISMATCH → "Davetin gönderildiği e-postayla giriş yapın" + 'Çıkış yap ve farklı hesapla gir' (logout → /login?redirect=…); EMAIL_NOT_VERIFIED → 'Doğrulama e-postasını yeniden gönder'; EXPIRED/INVALID → "{organizer} kişisinden yeni link isteyin". 'Seyahatlerim' yerine 'Ana sayfa'.

## F740 — Katılımcıya ödeme öncesi provizyon mantığı ve başarısızlık sonucu anlatılmıyor; son ödeme bilgisi en düşük vurguda

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Medium                                                                    |
| Durum               | Aday                                                                      |
| Konum               | `src/app/pay/share/[token]/page.tsx:205`                                  |
| Diğer konumlar      | `src/app/pay/share/[token]/page.tsx:216-225`, `messages/tr/cart.json:113` |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | learnability · predictability                                             |
| Sezgisel madde      | H13 — Feedforward                                                         |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | area:cart                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** 205-207 `<p className="mt-2 text-xs text-gray-500">{t(`status.${share.status}`)} · {t("deadline", ...)}</p>`: son ödeme en küçük ve gri metinde. "Payınız alındı. Tüm paylar ödenince ... kartınızdan tahsil edilecek." açıklaması (tr cart.json:113) yalnız ödeme sonrası (216-225) gösteriliyor; diğerleri ödemezse provizyonun iptal edileceği hiç söylenmiyor.

**Etki:** Katılımcı kartından hemen para çekileceğini sanabilir ya da bloke tutarın ne zaman serbest kalacağını bilmez; son ödeme saatini kaçırır.

**Önerilen aksiyon:** Ödeme formunun üstüne aria-describedby ile bağlı bilgi: "Kartınızdan şimdi {amount} için provizyon alınır; tüm paylar {deadline} saatine kadar ödenirse tahsil edilir, ödenmezse provizyon iptal edilir." Son ödeme satırını text-sm, saat ikonu ve göreli süreyle ayrı satıra taşı (renk değiştirmeden).

## F741 — Bölünmüş ödeme paneli yüklenirken ve yükleme hatasında plan yokmuş gibi davranıyor

| Alan                | Değer                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                        |
| Konum               | `src/components/cart/SplitPayPanel.tsx:82`                                                                                                                  |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:160`, `src/app/checkout/cart/page.tsx:229`, `src/app/checkout/cart/page.tsx:285`, `src/lib/cart/cart-payment.ts:197` |
| Kullanıcılar        | misafir                                                                                                                                                     |
| Prensip             | robustness · observability                                                                                                                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                       |
| Efor                | S                                                                                                                                                           |
| Kaynak denetçiler   | area:cart                                                                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                |

**Kanıt:** 82-84 `} catch { apply(null); }` ve 160 `if (!loaded) return null;`. Checkout'ta `splitActive` (page.tsx:229) panel yüklenene kadar false → aktif plan varken tek ödeme formu (285) görünür; hata durumunda kalıcı olarak hem tek ödeme formu hem 'Ödemeyi grupla bölüş' oluşturma formu çıkar. Sunucu tam ödemeyi "Bu sepet için bölünmüş ödeme başlatıldı" (cart-payment.ts:197) ile reddeder; ham mesaj gösterilir. /cart'ta panel sessizce kaybolur.

**Etki:** Organizatör, katılımcılar öderken tüm tutarı kendi kartıyla ödemeye ya da ikinci plan kurmaya çalışır; bilgi neden kaybolduğunu anlamaz.

**Önerilen aksiyon:** loaded=false iken paneli aria-busy="true" iskeletle göster ve checkout'ta onPlan sonucu gelene kadar ödeme formunu render etme. Hata durumunda panelde role="alert" "Bölünmüş ödeme durumu alınamadı" + 'Tekrar dene'; bu durumda create formunu ve tek ödeme formunu gösterme.

## F742 — Organizatörün pay durum listesi kendiliğinden güncellenmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/cart/SplitPayPanel.tsx:89`      |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:292-297` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · observability                      |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:cart                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** 89-92 `useEffect(() => { const timer = setTimeout(() => void load(), 0); ... }, [load]);` yalnız ilk yüklemede çalışır. Yoklama, visibilitychange yenilemesi veya 'Yenile' düğmesi yok; "{funded} / {total} ödendi" (292-297) ve durum çipleri (313-317) bayat kalır.

**Etki:** 60 dk son ödeme süresi içinde organizatör kimin ödediğini görmek için sayfayı elle yenilemek zorundadır; FALLBACK geçişini (kalanı kendisinin ödemesi gerektiğini) kaçırabilir.

**Önerilen aksiyon:** Plan COLLECTING/FALLBACK iken document.visibilityState === "visible" ise 15 sn'de bir load(); visibilitychange'te yenile. Başlık yanına 'Son güncelleme {time}' ve 'Yenile' düğmesi. Durum değişince role="status" ile "{email} payını ödedi" duyurusu.

## F743 — İptal edilmiş plandan sonra yeniden grupla bölme imkânı yok

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Aday                                                                          |
| Konum               | `src/components/cart/SplitPayPanel.tsx:174`                                   |
| Diğer konumlar      | `src/lib/cart/split-payment.ts:231-239`, `src/app/checkout/cart/page.tsx:229` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | robustness · task conformance                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                             |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | area:cart                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** Oluşturma formu yalnız 174 `if (!plan)` iken. GET split `currentPlanFor` aktif plan yoksa en son ABORTED planı döndürür (split-payment.ts:231-239 `plans.find((p) => p.status !== SplitPlanStatus.ABORTED) ?? plans[0]`). Ret veya 'Tutmayı bırak' sonrası sepet yeniden tutulduğunda panel "İptal edildi — ödemeler iade edildi" listesini gösterir; yeni plan düğmesi yok. splitActive false olduğundan (page.tsx:229) tek ödeme formu yanında görünür.

**Etki:** Organizatör grupla bölme seçeneğini o sepet için kalıcı olarak kaybeder; iade edilmiş pay listesini güncel durum sanabilir.

**Önerilen aksiyon:** plan.status === "ABORTED" ise listeyi daraltılabilir 'Önceki bölme iptal edildi ({date})' özetine çevir ve altında oluşturma formunu (allowCreate true ise) göster; ya da 'Yeniden böl' düğmesiyle setPlan(null).

## F744 — Arka planda değişen durumlar (bölünmüş ödeme payları, KYC 'beklemede', talep yazışmaları) otomatik güncellenmiyor

| Alan                | Değer                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                               |
| Durum               | Aday                                                                                                 |
| Konum               | `src/components/cart/SplitPayPanel.tsx:292`                                                          |
| Diğer konumlar      | `src/components/account/IdentityVerification.tsx:88`, `src/components/resolution/ClaimDetail.tsx:33` |
| Kullanıcılar        | misafir, ev sahibi                                                                                   |
| Prensip             | robustness · observability                                                                           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                       |
| WCAG                | 4.1.3                                                                                                |
| Renk/tema           | Hayır                                                                                                |
| Efor                | M                                                                                                    |
| Kaynak denetçiler   | lens:status                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                         |

**Kanıt:** SplitPayPanel.tsx:76-92 plan yalnız mount'ta okunuyor; 292-297 '{funded} / {total} ödendi' ve pay rozetleri (313-317) katılımcı ödedikçe değişmiyor. IdentityVerification.tsx:88 PENDING'de tek okuma. ClaimDetail.tsx:33-36 karşı tarafın yanıtını ancak sayfa yenilenince gösteriyor.

**Etki:** Grup organizatörü son ödeme saati baskısı altında katılımcıların ödeyip ödemediğini görmek için sürekli sayfayı yeniliyor; ev sahibi KYC sonucunu kaçırıyor.

**Önerilen aksiyon:** Görünür sekmede (document.visibilityState) 15–30 sn aralıklı yoklama veya SSE; değişiklikte role=status kısa duyuru ('Katılımcı 2 payını ödedi — 2/3'); 'Güncellendi 14:05' damgası ve elle 'Yenile' butonu.

## F745 — Pay satırındaki e-posta alanının görünür etiketi yalnız placeholder; 'isteğe bağlı' ifadesi çelişkili

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/cart/SplitPayPanel.tsx:339` |
| Diğer konumlar      | `messages/tr/cart.json:61`                  |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · Labels or Instructions      |
| Sezgisel madde      | H6 — Tanıma > hatırlama                     |
| WCAG                | 3.3.2                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:cart                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** 339-346 `<input type="email" aria-label={t("emailLabel")} placeholder={t("emailLabel")} className="w-48 ..." />`: yazmaya başlayınca görünür etiket kaybolur. Etiket "E-posta (isteğe bağlı)" (tr cart.json:61) ama yandaki 'E-postayla gönder' alan boşken disabled (350). Alan+düğme form içinde değil, Enter ile gönderilmez.

**Etki:** Kullanıcı yazarken alanın amacını unutabilir; 'isteğe bağlı' denip gönderim için zorunlu olması kafa karıştırır.

**Önerilen aksiyon:** Görünür `<label>` ekle; bu bağlam için yeni anahtar `inviteEmailLabel` ('Davet e-postası'); placeholder 'ornek@eposta.com'. Alan + düğmeyi küçük bir `<form onSubmit>` içine al (Enter ile gönderim).

## F1099 — Mobilde sepet kontrolleri 44px önerisinin altında (alanlar 30px, 'Kaldır' 28px, 'Sepete dön' 20px)

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Low                                                                       |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/app/cart/page.tsx:11`                                                |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx`, `src/components/cart/SplitPayPanel.tsx` |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | accessibility · Erişilebilirlik / dokunma ergonomisi                      |
| Sezgisel madde      | H14 — Erişilebilirlik                                                     |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:cart                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** p11 (mobil 390, TR) boyutları: Yetişkin ve Çocuk input 80x30, Oda adedi select 80x31, 'Kaldır' 61x28, kalem başlık bağlantısı 223x21. Sweep 069 için targetsLt44Count=5. 071 /checkout/cart'ta 'Sepete dön' 70x20. p5: bölüşme '×' düğmesi 24x28, '+ Katılımcı ekle' 98x24. p6: 'Linki kopyala' 109x30, durum listesi e-posta alanı 192x30. WCAG 2.5.8 için 24px ya da boşluk koşulu sağlanıyor, yani AA ihlali değil.

**Etki:** Mobil ağırlıklı misafirlerde yanlış dokunma riski var; özellikle 'Kaldır' ve onaysız silme birleşince bu risk büyüyor.

**Önerilen aksiyon:** Mobilde input sınıfını py-2.5 ve min-h-11 yap (cart/page.tsx:11-12). 'Kaldır', '×', 'Sepete dön' ve '+ Katılımcı ekle' için min-h-11 ve yeterli yatay dolgu ver. Kişi sayıları için 44px −/+ stepper kullan.

## F1100 — Oda adedi seçimi 5 ile sınırlı ama API 10'a izin veriyor; sınır açıklanmıyor

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Gözlemlendi                            |
| Konum               | `src/app/cart/page.tsx:176`            |
| Diğer konumlar      | `src/lib/cart/schemas.ts`              |
| Kullanıcılar        | misafir                                |
| Prensip             | flexibility · Tutarlılık / feedforward |
| Sezgisel madde      | H4 — Tutarlılık/standartlar            |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | runtime:cart                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** p3: oda adedi seçenekleri ['1','2','3','4','5'] ([1,2,3,4,5].map, satır 176). Sunucu cartItemPatchSchema quantity için max(10) tanımlıyor (schemas.ts:31). Arayüzde sınır hakkında ipucu yok.

**Etki:** 6-10 oda isteyen grup organizatörü (sepetin temel kullanım senaryosu) bunun mümkün olmadığını sanıyor ve aynı odayı birden çok kez eklemeye çalışıyor.

**Önerilen aksiyon:** Seçenekleri sunucu sınırıyla (1-10) eşle ya da sınırı paylaşılan bir sabitten üret. Müsaitlik sınırı varsa 'En fazla N oda' ipucu göster.

## F1101 — Kart son kullanma tarihi '12/30' olarak önceden doldurulmuş (paylaşım ve sepet ödeme formları)

| Alan                | Değer                                   |
| ------------------- | --------------------------------------- |
| Severity            | Low                                     |
| Durum               | Gözlemlendi                             |
| Konum               | `src/app/pay/share/[token]/page.tsx:33` |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx`        |
| Kullanıcılar        | misafir                                 |
| Prensip             | robustness · Hata önleme                |
| Sezgisel madde      | H5 — Hata önleme                        |
| Renk/tema           | Hayır                                   |
| Efor                | S                                       |
| Kaynak denetçiler   | runtime:cart                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**            |

**Kanıt:** p9-share-pay (desktop TR): inputs=['Kart numarası value=""', 'Son kullanma (AA/YY) value="12/30"', 'CVC value=""']. p4 sepet ödeme formunda da '12/30' önceden dolu (crops/cart/p4d-0.png). Kaynak: useState({ number: '', exp: '12/30', cvc: '' }) (share satır 33, checkout/cart satır 36).

**Etki:** Gerçek akışta kullanıcı dolu alanı kontrol etmeden geçer ve kart reddedilir ya da yanlış veri gönderilir. Demo kolaylığı üretim davranışı gibi görünüyor.

**Önerilen aksiyon:** Alanı boş başlat ve placeholder 'AA/YY' kullan. Demo kolaylığı gerekiyorsa test kartı ipucuna tıklanınca tüm alanları dolduran bir 'Test kartını kullan' düğmesi ekle.

## F1215 — Sepet sayfasında devre dışı kontroller görsel olarak farklılaşmıyor; ortak Button bileşeni kullanılmıyor

| Alan                | Değer                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                       |
| Durum               | Aday                                                                                                                                                      |
| Konum               | `src/app/cart/page.tsx:11`                                                                                                                                |
| Diğer konumlar      | `src/app/cart/page.tsx:87`, `src/app/cart/page.tsx:103`, `src/app/cart/page.tsx:226`, `src/app/checkout/cart/page.tsx:352`, `src/components/ui/ui.tsx:38` |
| Kullanıcılar        | misafir                                                                                                                                                   |
| Prensip             | learnability · consistency (affordance)                                                                                                                   |
| Sezgisel madde      | H11 — Affordance                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                     |
| Efor                | S                                                                                                                                                         |
| Kaynak denetçiler   | area:cart                                                                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                              |

**Kanıt:** 11-12 `input` sınıfında disabled: varyantı yok; 'Süresi dolan sepeti geri yükle' (87), 'Tutmayı bırak' (103), 'Sepeti boşalt' (226) ve checkout 'Tutmayı bırak' (352) düğmelerinde disabled: stili yok. Tailwind preflight renkleri inherit ettiğinden kilitli/busy durumda alanlar etkin görünüyor. Ortak `Button` `disabled:cursor-not-allowed disabled:opacity-60` sağlıyor (ui.tsx:38) ama kullanılmıyor.

**Etki:** Kilitli sepette misafir alanları düzenlemeye çalışır, tepki alamayınca sistemi bozuk sanar.

**Önerilen aksiyon:** Palete dokunmadan `disabled:cursor-not-allowed disabled:opacity-60` ekle veya ui.tsx Button'ı kullan; kilitli alanlara aria-describedby ile lockedNotice id'sini bağla.

## F1216 — Yükleme durumları duyurulmuyor; bölme paneli yüklenirken hiçbir şey göstermiyor

| Alan                | Değer                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                         |
| Durum               | Aday                                                                                                                        |
| Konum               | `src/app/cart/page.tsx:55`                                                                                                  |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:171`, `src/app/pay/share/[token]/page.tsx:171`, `src/components/cart/SplitPayPanel.tsx:160` |
| Kullanıcılar        | misafir                                                                                                                     |
| Prensip             | robustness · observability                                                                                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                              |
| WCAG                | 4.1.3                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                       |
| Efor                | S                                                                                                                           |
| Kaynak denetçiler   | area:cart                                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                |

**Kanıt:** 55 `<p className="text-gray-500">{t("loading")}</p>` role/aria-live yok; checkout/cart:171 ve share:171 aynı. SplitPayPanel.tsx:160 `if (!loaded) return null;` → gösterge yok, panel sonradan belirince düzen kayar.

**Etki:** Yavaş ağda ekran okuyucu kullanıcısı sayfanın boş mu yoksa yükleniyor mu olduğunu bilemez; geç beliren panel, tıklanmak üzere olan öğeyi aşağı iter.

**Önerilen aksiyon:** Yükleme metnine role="status" ekle; SplitPayPanel yüklenirken sabit yükseklikli iskelet ve aria-busy="true" göster.

## F1217 — İlan adı bağlantısı dinlenme durumunda bağlantı gibi görünmüyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Low                                        |
| Durum               | Aday                                       |
| Konum               | `src/app/cart/page.tsx:120`                |
| Kullanıcılar        | misafir                                    |
| Prensip             | learnability · predictability (affordance) |
| Sezgisel madde      | H11 — Affordance                           |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cart                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** 118-123 `<Link href={`/property/${item.propertyId}`} className="font-semibold text-gray-900 hover:underline">`: alt çizgi veya ikon yok, çevre metinle aynı renk; dokunmatik cihazda hover yok.

**Etki:** Mobil misafir otel sayfasına dönüp detayı kontrol edebileceğini fark etmez.

**Önerilen aksiyon:** Renk değiştirmeden `underline decoration-1 underline-offset-2` ekle veya ayrı 'İlanı görüntüle' ikincil bağlantısı koy.

## F1218 — Anlam taşıyan semboller ekran okuyucuda ham okunuyor (→, ·, ×, +)

| Alan                | Değer                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                                                    |
| Durum               | Aday                                                                                                                                                                                                                   |
| Konum               | `src/app/cart/page.tsx:129`                                                                                                                                                                                            |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:192`, `src/app/checkout/cart/page.tsx:241-242`, `src/app/pay/share/[token]/page.tsx:188-189`, `src/components/cart/SplitPayPanel.tsx:203`, `src/components/cart/SplitPayPanel.tsx:249` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                |
| Prensip             | accessibility · Info and Relationships                                                                                                                                                                                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                  |
| WCAG                | 1.3.1                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                  |
| Efor                | S                                                                                                                                                                                                                      |
| Kaynak denetçiler   | area:cart                                                                                                                                                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                           |

**Kanıt:** cart/page.tsx:129-130 `{f.date(item.checkIn, "medium")} →{" "}`; checkout/cart/page.tsx:192 ve 241-242 (`·`, `×`, `→`); share page:188-189 (`→`); SplitPayPanel.tsx:203 (`·`), 237 (`×` tek içerik), 249 (`+ {t("addParticipant")}`).

**Etki:** Ekran okuyucu 'sağ ok', 'orta nokta', 'çarpı' okur; tarih aralığı ve oda adedi anlaşılmaz.

**Önerilen aksiyon:** Ayraçları `<span aria-hidden="true">→</span><span className="sr-only">{t("to")}</span>` biçiminde ver (yeni 'to' anahtarı: 'ile'/'to'); '× 2' yerine `t("item.roomsCount", { count })` ('2 oda'); '+' işaretini aria-hidden yap.

## F1219 — 'Artık açık değil' mesajı payın gerçek durumuyla çelişebiliyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Low                                      |
| Durum               | Aday                                     |
| Konum               | `src/app/pay/share/[token]/page.tsx:226` |
| Kullanıcılar        | misafir                                  |
| Prensip             | robustness · observability               |
| Sezgisel madde      | H9 — Hata mesajları                      |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | area:cart                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**             |

**Kanıt:** 226-230 `{!paid && !share.canPay && (<p ...>{t("share.closed")}</p>)}`: pay başka hesapça ödenmişse (AUTHORIZED, paidByMe false) veya süre geçmiş ama plan hâlâ aktifse de "Bu bölünmüş ödeme artık açık değil." yazar; üstte durum 'Ödendi (onay bekliyor)' görünebilir.

**Etki:** Katılımcı payının ödenip ödenmediğinden emin olamaz; organizatöre gereksiz soru sorar veya tekrar ödemeye çalışır.

**Önerilen aksiyon:** Nedene göre metin: FUNDED && !paidByMe → "Bu pay başka bir hesapla ödendi"; deadline geçti → t("share.deadlinePassed"); SETTLED → t("share.confirmed"); ABORTED → "Plan iptal edildi, ödeme alınmadı".

## F1220 — Ödeme ve devir bağlantıları yalnız panoya kopyalanıyor, mobil paylaşım menüsü yok

| Alan                | Değer                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                            |
| Durum               | Aday                                                                                           |
| Konum               | `src/components/cart/SplitPayPanel.tsx:135`                                                    |
| Diğer konumlar      | `src/components/transfers/TransferMarket.tsx:139`, `src/components/cart/SplitPayPanel.tsx:138` |
| Kullanıcılar        | misafir                                                                                        |
| Prensip             | flexibility · substitutivity                                                                   |
| Sezgisel madde      | H7 — Esneklik/verim                                                                            |
| Renk/tema           | Hayır                                                                                          |
| Efor                | S                                                                                              |
| Kaynak denetçiler   | lens:mobile                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                   |

**Kanıt:** SplitPayPanel.tsx:133-140 `navigator.clipboard.writeText(share.inviteUrl)` başarısız olursa `window.prompt(...)` gösteriyor. TransferMarket.tsx:136-144 de yalnız kopyalıyor. Kod tabanında `navigator.share` hiç kullanılmıyor.

**Etki:** Bölünmüş ödeme davetini WhatsApp ya da SMS ile göndermek isteyen mobil organizatör kopyala, uygulama değiştir, yapıştır yapmak zorunda. iOS'ta `window.prompt` geri dönüşünde uzun URL'yi seçmek zor.

**Önerilen aksiyon:** `navigator.share` varsa 'Paylaş' düğmesi göster: `navigator.share({ title, text: 'Payını öde', url })`. Kopyalamayı ikincil seçenek olarak bırak. prompt yerine salt okunur bir input ve 'Kopyalandı' durumu kullan (TransferMarket.tsx:198-215'teki desen).

## F1221 — Kopyalama/gönderim bildirimi kalıcı, satırdan uzak ve tekrarda yeniden duyurulmuyor

| Alan                | Değer                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                   |
| Durum               | Aday                                                                                                                                  |
| Konum               | `src/components/cart/SplitPayPanel.tsx:136`                                                                                           |
| Diğer konumlar      | `src/components/cart/SplitPayPanel.tsx:152`, `src/components/cart/SplitPayPanel.tsx:143`, `src/components/cart/SplitPayPanel.tsx:170` |
| Kullanıcılar        | misafir                                                                                                                               |
| Prensip             | robustness · observability                                                                                                            |
| Sezgisel madde      | H12 — Feedback                                                                                                                        |
| WCAG                | 4.1.3                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                 |
| Efor                | S                                                                                                                                     |
| Kaynak denetçiler   | area:cart                                                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                          |

**Kanıt:** 136 `setNotice(t("copied"))` ve 152 `setNotice(t("sent"))` hiç temizlenmiyor; ikinci kopyalamada aynı metin set edildiği için DOM değişmiyor ve canlı bölge yeniden duyurmuyor. Bildirim panelin en altında (170), satırdan uzak; hangi katılımcı olduğu yazmıyor. sendInvite (143) yalnız message'ı sıfırlıyor, eski başarı bildirimi yeni hatayla yan yana kalabiliyor.

**Etki:** Kullanıcı ikinci linkin de kopyalandığından emin olamaz; mobilde bildirimi görmez; çelişkili başarı+hata aynı anda görünür.

**Önerilen aksiyon:** notice'u `{ text, key: Date.now() }` olarak tut, 4 sn sonra temizle; metin "Katılımcı 2 linki kopyalandı"; copy/sendInvite başında setNotice(null); düğme etiketini 2 sn 'Kopyalandı' yap (satır içi geri bildirim).

## F1222 — Eşit bölmede satır tutarı etiketsiz gösteriliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/cart/SplitPayPanel.tsx:228` |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · Info and Relationships      |
| Sezgisel madde      | H6 — Tanıma > hatırlama                     |
| WCAG                | 1.3.1                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:cart                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** 228 `<span className="pb-2 text-sm text-gray-700">{f.money(equalShare, currency)}</span>`: 'Pay' etiketi yok; ekran okuyucu yalnız tutarı okur.

**Etki:** Ekran okuyucu kullanıcısı tutarın katılımcı payı olduğunu bağlamdan çıkarmak zorunda kalır.

**Önerilen aksiyon:** Görünür veya sr-only etiket: `{t("shareOf", { n: i + 1 })}: {amount}` ("Katılımcı 1 payı: ₺3.264,97").

## F1223 — '×' katılımcı kaldırma düğmesi küçük hedef ve yalnız glif

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/cart/SplitPayPanel.tsx:231` |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · Target Size (Minimum)       |
| Sezgisel madde      | H11 — Affordance                            |
| WCAG                | 2.5.8                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:cart                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** 231-238 `<button ... className="pb-2 text-sm font-semibold text-red-700 hover:underline" aria-label={t("removeParticipant")}>×</button>`: genişlik ~8-10px; mobilde e-posta/tutar alanının hemen yanında.

**Etki:** Mobil ağırlıklı misafir yanlış dokunuşla katılımcıyı siler ya da düğmeye isabet ettiremez.

**Önerilen aksiyon:** `inline-flex h-11 w-11 items-center justify-center` (en az 24×24) ve görünür 'Kaldır' metni veya çöp kutusu ikonu + sr-only metin.

## F1224 — Katılımcı ekleme sınırı sessizce uygulanıyor; eklenen satıra odak verilmiyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/cart/SplitPayPanel.tsx:243` |
| Diğer konumlar      | `src/lib/config/app-config.ts:68`           |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · predictability               |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:cart                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** 243-251 `{rows.length < 9 && (<button ...>+ {t("addParticipant")}</button>)}`: 9'da düğme kaybolur (odaktaysa odak da kaybolur), sınır yazılmaz. Sunucu sınırı config'ten (SPLIT_PAY_MAX_SHARES=10, app-config.ts:68), istemcide sabit 9. Ekleme sonrası yeni e-posta alanına odak yok.

**Etki:** 10'dan kalabalık grup neden ekleyemediğini anlamaz; klavye kullanıcısı yeni satırı arar.

**Önerilen aksiyon:** Düğmeyi gizlemek yerine aria-disabled + "En fazla 9 katılımcı (siz dahil 10 kişi)" yardım metni; sınırı GET split yanıtından al; eklemeden sonra yeni satırın e-posta input'una focus().

## F1225 — Bölüm ve form adları görünür başlıkla uyumsuz (aria-label yerine aria-labelledby)

| Alan                | Değer                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                            |
| Durum               | Aday                                                                                                                                                           |
| Konum               | `src/components/cart/SplitPayPanel.tsx:275`                                                                                                                    |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:289`, `src/app/checkout/cart/page.tsx:382`, `src/app/pay/share/[token]/page.tsx:237`, `src/app/pay/share/[token]/page.tsx:297` |
| Kullanıcılar        | misafir                                                                                                                                                        |
| Prensip             | accessibility · Info and Relationships                                                                                                                         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                    |
| WCAG                | 1.3.1                                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                          |
| Efor                | S                                                                                                                                                              |
| Kaynak denetçiler   | area:cart                                                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                   |

**Kanıt:** 275 `aria-label={t("sharesTitle")}` ('Paylar') ama görünür h2 'Ödemeyi grupla bölüş' (279). Formlarda h2 metni aria-label ile kopyalanmış: checkout/cart 289 ve 382, share 237 ve 297.

**Etki:** Ekran okuyucu bölge listesinde görünenden farklı ad duyar; çeviri güncellenince iki metin birbirinden kopabilir.

**Önerilen aksiyon:** h2'lere id verip section/form'larda aria-labelledby kullan; aria-label'ları kaldır.

## F1226 — Uzun e-posta adresleri 320px genişlikte yatay taşma yaratabiliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/cart/SplitPayPanel.tsx:302` |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · Reflow                      |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 1.4.10                                      |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:cart                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** 302-308 `<span className="text-gray-800">{... s.participantEmail ...}</span>`: break-all/min-w-0 yok; flex öğesinin min-width:auto değeri ~44 karakterlik adreste (~330px) 360px ekrandaki ~288px içerik genişliğini aşar.

**Etki:** Mobil misafir yatay kaydırma yapmak zorunda kalır; tutar ve durum çipi ekran dışına itilir.

**Önerilen aksiyon:** span'a `min-w-0 break-all` (veya `[overflow-wrap:anywhere]`) ekle.
