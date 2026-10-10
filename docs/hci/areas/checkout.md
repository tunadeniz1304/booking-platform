# Ödeme akışı — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 86 bulgu · Severity: Critical 3, High 30, Medium 38, Low 15

## F5 — Aynı sekmede yeniden rezervasyon denemesi iptal edilmiş ya da süresi dolmuş eski rezervasyona yönlendiriyor (idempotency anahtarı hiç yenilenmiyor)

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                      |
| Durum               | Gözlemlendi                                                                                   |
| Konum               | `src/app/checkout/page.tsx:22`                                                                |
| Diğer konumlar      | `src/lib/booking-service.ts`                                                                  |
| Kullanıcılar        | misafir                                                                                       |
| Prensip             | robustness · Task conformance ve recoverability: kullanıcı aynı görevi yeniden başlatabilmeli |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                             |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | runtime:checkout                                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                                                      |

**Kanıt:** RUNTIME probes/checkout/p17-rebook-same-tab.mjs (masaüstü, TR, kendi demo rezervasyonum): checkout'ta 'Rezervasyonu Tamamla' tıklandı, POST /api/bookings 201 döndü ve rezervasyon HELD oldu (cmv2we4yb003jkd9zozva7bvb, idem=83eb9dc7...). Rezervasyon iptal edildi, tarayıcıda Geri ile checkout'a dönülüp yeniden 'Rezervasyonu Tamamla' tıklandı. Sonuç: POST /api/bookings 201, aynı id, status CANCELLED, aynı idem anahtarı. Kullanıcı 'Rezervasyon iptal edildi' sayfasına düştü (crops/checkout/p17-rebook-same-tab.png). KOD: useStableIdempotencyKey anahtarı sessionStorage'da sekme boyunca tutuyor ve başarılı oluşturmadan sonra silmiyor (page.tsx:22-40, 61-63). Sunucudaki findByIdempotencyKey eşleşen kaydı durumuna bakmadan döndürüyor (booking-service.ts:279-282). Tutma süresi dolmuş HELD rezervasyon da aynı yoldan döner; p11 probunda böyle bir rezervasyona ödeme 409 HOLD_EXPIRED veriyor, yani kullanıcı bir döngüye giriyor.

**Etki:** Tutma süresi dolduğu ya da fikrini değiştirdiği için aynı konaklamayı yeniden ayırtmak isteyen misafir hep ölü rezervasyona dönüyor. Sayfayı yenilemek de işe yaramıyor (sessionStorage kalıyor). Ancak yeni sekme açarsa ya da parametre değiştirirse kurtuluyor, bunu ise kimse tahmin edemez.

**Önerilen aksiyon:** İstemcide başarılı yanıttan sonra router.push öncesinde sessionStorage.removeItem(`checkout-idem:${scope}`) çağrılsın ya da anahtara bookingId bağlansın. Sunucuda eşleşen kayıt CANCELLED, EXPIRED ya da holdExpiresAt geçmiş HELD ise idempotent yanıt verilmesin: 409 IDEMPOTENCY_STALE dönülsün ve istemci yeni anahtarla yeniden denesin.

**Yapılan düzeltme:** useStableIdempotencyKey in page.tsx now returns {key, reset}. After a successful POST, reset() writes a new UUID to sessionStorage, so a second booking attempt in the same tab opens a new booking instead of landing on the cancelled one. If the response is lost or the request fails, the old key is kept so a retry still dedupes. The server side (a CANCELLED/EXPIRED or expired-hold match returns 409 IDEMPOTENCY_STALE) is in crossOwner. — dosyalar: `src/app/checkout/page.tsx`

## F6 — 3DS'de yanlış kod sonrası çıkmaz: ödeme reddedilmiş ama arayüz kod ekranında kalıyor, doğru kod 'Doğrulama bekleyen ödeme yok' hatası veriyor

| Alan                | Değer                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                |
| Durum               | Gözlemlendi                                                                                             |
| Konum               | `src/components/booking/BookingActions.tsx:187`                                                         |
| Diğer konumlar      | `src/lib/payment/mock-psp.ts`                                                                           |
| Kullanıcılar        | misafir                                                                                                 |
| Prensip             | robustness · Recoverability (geri kazanılabilirlik): hata sonrası kullanıcıya ileri bir yol bırakılmalı |
| Sezgisel madde      | H9 — Hata mesajları                                                                                     |
| Renk/tema           | Hayır                                                                                                   |
| Efor                | S                                                                                                       |
| Kaynak denetçiler   | runtime:checkout                                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutA)                                                                       |

**Kanıt:** RUNTIME probes/checkout/p7-3ds.mjs (mobil 390x844, TR, kendi oluşturduğum rezervasyon cmv2vy0yc001gkd9zb0dc5zlu): TEST_CARD_3DS ile POST /pay 202 requires_action. Koda 000000 girildi: POST /pay/confirm 402 PAYMENT_DECLINED (declineCode authentication_failed), ekranda 'Ödeme reddedildi. Lütfen başka bir kart deneyin.' görünüyor ama kart formu yok, '3D Secure doğrulaması' formu ve kod alanı duruyor. Ardından MOCK_3DS_CODE girildi: 409 NO_PENDING_CHALLENGE, ekranda 'Doğrulama bekleyen ödeme yok' yazıyor. Görünen tek düğmeler 'Doğrula', 'Rezervasyonu iptal et', 'Yazdır'; geri dönüş ya da 'başka kart' seçeneği yok. Escape bir şey yapmıyor. Ekran görüntüsü: crops/checkout/p7-3ds-mobile-tr-done.png. Kurtulmanın tek yolu sayfayı yenilemek; p7b-3ds-recover.mjs'de yenileme sonrası kart formu geri geliyor. KOD: confirm3ds catch bloğu (BookingActions.tsx:197-203) yalnız mesaj yazıyor, setChallenge(null) çağırmıyor. Challenge formunda (323-342) vazgeç ya da geri düğmesi yok.

**Etki:** Kod yazarken tek bir hata yapan misafir ödemeyi tamamlayamıyor. Yönlendirme 'başka kart deneyin' diyor ama kart alanı yok. Bu sırada 15 dakikalık tutma süresi işlemeye devam ediyor ve oda kaybedilebilir. Hata metni yanlış koddan değil kartın reddinden söz ettiği için asıl neden de gizleniyor.

**Önerilen aksiyon:** confirm3ds catch bloğunda ApiError.code PAYMENT_DECLINED, NO_PENDING_CHALLENGE ya da ATTEMPTS_EXCEEDED ise şunlar yapılsın: setChallenge(null) ve setCode("") çağrılsın, kart formuna dönülsün, odak kart numarası alanına alınsın. authentication_failed için ayrı bir metin gösterilsin: 'Doğrulama kodu hatalı, ödeme alınmadı. Kart bilgilerinizi kontrol edip yeniden deneyin.' Ayrıca challenge formuna her zaman görünen bir 'Geri dön / başka kart kullan' düğmesi eklensin.

**Yapılan düzeltme:** confirm3ds catch: when the error code is PAYMENT_DECLINED, NO_PENDING_CHALLENGE or PAYMENT_ATTEMPTS_EXCEEDED, backToCard() runs. It clears the challenge and code, takes a new Idempotency-Key and moves focus to the card number. declineCode=authentication_failed shows its own text (errors.AUTHENTICATION_FAILED). The 3DS form now always shows a 'Geri dön, başka kart kullan' button. — dosyalar: `src/components/booking/BookingActions.tsx`

## F24 — Ödeme akışında 3DS adımı ve ödeme sonucu ekran okuyucuya duyurulmuyor; odak kayboluyor

| Alan                | Değer                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                       |
| Konum               | `src/components/booking/BookingActions.tsx:323`                                                                                                                                                            |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:172`, `src/app/booking/[id]/page.tsx:117`, `src/app/checkout/cart/page.tsx:176`, `src/app/checkout/cart/page.tsx:379`, `src/app/pay/share/[token]/page.tsx:294` |
| Kullanıcılar        | misafir                                                                                                                                                                                                    |
| Prensip             | robustness · observability                                                                                                                                                                                 |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                             |
| WCAG                | 4.1.3                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                      |
| Efor                | M                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:a11y                                                                                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                                                                                   |

**Kanıt:** BookingActions.tsx:265 ödeme formu `{status === "HELD" && !useStripeForm && !challenge && (<form onSubmit={pay} ...>`; 3DS gerekince 170-171 `setChallenge(...)` formu DOM'dan kaldırıyor, 323'te `{challenge && (<form onSubmit={confirm3ds} ...>` açılıyor — canlı bölge ya da odak taşıma yok, basılan 'Öde' düğmesi kalkınca odak <body>'ye düşüyor. Başarıda yalnız 172 `else onChanged();` — hiçbir mesaj yazılmıyor (mesaj alanı 363-370 yalnız hata/info için). booking/[id]/page.tsx:117-119 h1 `t(`status.${booking.status}`)` sessizce 'Onaylandı'ya dönüyor. Sepet: checkout/cart/page.tsx:176-213 `if (done) return (<main ...><h1 ...>{t("checkout.success")}` tüm main'i değiştiriyor; 379-406 ve pay/share/[token]/page.tsx:294-321'de 3DS formu aynı şekilde sessiz açılıyor.

**Etki:** Misafir (ekran okuyucu / klavye, mobil ağırlıklı): 'Öde ve onayla'dan sonra hiçbir şey duymaz; 3DS kodunun istendiğini fark etmezse 'holdUntil' süresi dolar ve rezervasyon düşer; başarı duyurulmadığı için ödemenin alınıp alınmadığını bilemez, tekrar dener ya da sayfadan çıkar. Birincil 'öde' görevi ekran okuyucuyla güvenilir biçimde tamamlanamıyor.

**Önerilen aksiyon:** Bileşende her zaman DOM'da duran boş bir `<p role="status" aria-live="polite">` tutun. `challenge` set edilince buraya '3D Secure doğrulaması gerekiyor — bankanızın gönderdiği kodu girin' yazın ve useEffect ile 3DS formundaki `<h2 tabIndex={-1}>` öğesine ya da kod alanına `.focus()` verin. Başarılı ödemede onChanged() öncesi aynı bölgeye 'Ödeme alındı, rezervasyon onaylandı' yazın; booking/[id] sayfasında durum değişince h1'e (tabIndex=-1) odak verin. checkout/cart `done` görünümü ve pay/share 3DS formu için aynı odak+duyuru kalıbını uygulayın.

**Yapılan düzeltme:** Added a single role=status aria-live=polite region that is always in the DOM. It announces when 3DS opens (threeDsAnnounce), on successful payment (paidAnnounce), hold warnings and cancel results. Focus moves to the code field when 3DS opens. Not done because other teams own them: focusing the h1 on booking/[id] and the cart/share pages. — dosyalar: `src/components/booking/BookingActions.tsx`

## F64 — İptal onayı iade tutarını/politikasını göstermiyor (geri dönüşsüz para işlemi feedforward'sız)

| Alan                | Değer                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                  |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                                                       |
| Konum               | `src/components/booking/BookingActions.tsx:208`                                                                                                       |
| Diğer konumlar      | `src/lib/support/tools.ts`, `src/app/booking/[id]/page.tsx`, `messages/tr/payment.json`, `messages/tr/payment.json:21`, `messages/en/payment.json:21` |
| Kullanıcılar        | misafir                                                                                                                                               |
| Prensip             | learnability · Predictability (operation visibility) / öngörülebilirlik                                                                               |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                     |
| WCAG                | 3.3.4 (ruhu: finansal işlemde bilgilendirilmiş onay)                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                 |
| Efor                | M                                                                                                                                                     |
| Kaynak denetçiler   | runtime:trips, area:checkout                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                              |

**Kanıt:** Probe p-booking.mts (1280x800 TR, API Playwright route ile taklit): 'Rezervasyonu iptal et' odak+Enter -> dialog.type()='confirm', metin yalnızca 'Rezervasyonu iptal etmek istediğinize emin misiniz?' (EN: 'Are you sure you want to cancel the booking?'); tutar, yüzde, son ücretsiz iptal tarihi yok. Vazgeç -> DELETE çağrısı 0, odak düğmeye döndü. p-cancel-accept.mts (sahte id, DELETE yerelde karşılandı) kabul edilince sonuç ancak sonradan öğreniliyor: 'İptal edildi. Politika gereği iade yok.'. Gerçek oturumlu tarama 072/073 gövde metni: 'Toplam Tutar ₺7.350,00' ardından doğrudan 'Rezervasyonu iptal et' — sayfada hiçbir yerde iptal politikası yok. Sunucu iade teklifini zaten hesaplayabiliyor: src/lib/support/tools.ts:86 cancellationQuote (computeRefund). Yerel window.confirm olduğu için düğme etiketleri tarayıcıya ait, 'Vazgeç / Evet, iptal et' gibi net etiket verilemiyor (görsel olarak yakalanamadı, dialog tipi gözlendi).

**Etki:** Misafir %0 iade alacağını bilmeden 7.350 TL'lik rezervasyonu tek onayla iptal edebilir; geri alma yolu yok. Para kaybı riski + güven kaybı; düşük okuryazarlıktaki mobil kullanıcı için en kritik karar anı.

**Önerilen aksiyon:** window.confirm yerine sayfa içi role=alertdialog (odak tuzağı, Esc=Vazgeç) kullanın; açılırken yeni GET /api/bookings/[id]/cancellation-quote (cancellationQuote/computeRefund yeniden kullanılarak) çağırıp 'İade: ₺X (%Y) · {tarih} sonrası iade yok' gösterin; düğmeler 'Vazgeç' (varsayılan odak) ve 'Evet, rezervasyonu iptal et'. Politika özetini iptal düğmesinin yanında kalıcı olarak da gösterin (aria-describedby ile düğmeye bağlayın).

**Yapılan düzeltme:** window.confirm replaced with useConfirm (native dialog, tone=danger, focus starts on Vazgeç, Esc closes). Buttons read 'Evet, iptal et' / 'Rezervasyonu koru'. The body explains the outcome separately for HELD and CONFIRMED and says the action cannot be undone. Showing the refund amount and percentage up front needs a backend refund-preview endpoint, so it was not done. — dosyalar: `src/components/booking/BookingActions.tsx`

## F103 — Checkout'taki rezervasyon isteği oturum tazelemesi yapmıyor: geçerli oturumu olan misafir girişe atılıyor

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                |
| Durum               | Gözlemlendi                                                                                         |
| Konum               | `src/app/checkout/page.tsx:104`                                                                     |
| Diğer konumlar      | `src/lib/api-client.ts`, `src/lib/config/app-config.ts`                                             |
| Kullanıcılar        | misafir                                                                                             |
| Prensip             | robustness · Task conformance: görev sırasında sistem kendi teknik kısıtını kullanıcıya yüklememeli |
| Sezgisel madde      | H5 — Hata önleme                                                                                    |
| Renk/tema           | Hayır                                                                                               |
| Efor                | S                                                                                                   |
| Kaynak denetçiler   | runtime:checkout                                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutB)                                                                   |

**Kanıt:** RUNTIME probes/checkout/p2b-expired-access.mjs (masaüstü, TR): kendi açtığım oturumdan 'token' çerezi silinerek ACCESS_TOKEN_TTL_SECONDS=300 sonrasındaki durum taklit edildi; refresh_token geçerliydi. Checkout'ta 'Rezervasyonu Tamamla' tıklandığında POST /api/bookings 401 döndü ve /login?redirect=… sayfasına geçildi. Login sayfasında Header'ın apiFetch çağrısı POST /api/auth/refresh 200 aldı ve üst çubukta 'AD Ayşe Çıkış yap' görünürken kullanıcıdan 'Giriş Yap' isteniyor (crops/checkout/p2b-login-while-session.png). KOD: checkout ham fetch kullanıyor ve 401'de doğrudan router.replace('/login…') yapıyor (page.tsx:104-126). apiFetch'in refresh+retry mantığı (api-client.ts:66-68) atlanıyor. Checkout'ta Header olmadığı için sayfada token'ı tazeleyen başka bir istek de yok (taramada landmarks header:0).

**Etki:** Checkout'ta 5 dakikadan uzun kalan, örneğin fiyatı karşılaştıran ya da kupon arayan oturumlu misafir giriş sayfasına düşüyor ve parolasını yeniden girmesi isteniyor. Ekranda oturumlu göründüğü için de çelişkili bir durum oluşuyor. Bu, rezervasyonu terk etme riskini artırıyor.

**Önerilen aksiyon:** POST /api/bookings çağrısı apiFetch ile yapılsın; böylece 401'de bir kez /api/auth/refresh denenip istek tekrarlanır. Yönlendirme yalnızca ApiError.status===401 ve tazeleme başarısız olduğunda yapılsın.

**Yapılan düzeltme:** POST /api/bookings now goes through apiFetch, so on a 401 it calls /api/auth/refresh once and retries. Redirect to login happens only when apiFetch still throws ApiError 401, using loginHref(returnTo()). Error handling moved from data.code to err.code. — dosyalar: `src/app/checkout/page.tsx`

## F104 — Tutma (hold) süresi dolunca sayfa hâlâ 'Oda sizin için tutuluyor' diyor; geri sayım, uyarı ve kurtarma eylemi yok

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                        |
| Durum               | Gözlemlendi                                                                                 |
| Konum               | `src/components/booking/BookingActions.tsx:268`                                             |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx`, `messages/tr/payment.json`                                 |
| Kullanıcılar        | misafir                                                                                     |
| Prensip             | robustness · Observability ve responsiveness: sistem durumu zamanında ve doğru yansıtılmalı |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                              |
| WCAG                | 2.2.1 Timing Adjustable (A), 4.1.3 Status Messages (AA)                                     |
| Renk/tema           | Hayır                                                                                       |
| Efor                | M                                                                                           |
| Kaynak denetçiler   | runtime:checkout                                                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                    |

**Kanıt:** RUNTIME probes/checkout/p11-hold-expiry.mjs (masaüstü, TR, 18 dk): rezervasyon cmv2w8p6z0034kd9zr5ztobht, holdExpiresAt 21:30:48Z. Sayfa açık kaldı ve her dakika örneklendi. Süre dolduktan 2 dk sonra bile h1 'Oda sizin için tutuluyor — ödemeyi tamamlayın' idi ve canlı bölge boştu (live: []). Ödeme denendiğinde 409 'Rezervasyon tutma süresi doldu' döndü. Hata 'Rezervasyonu iptal et' düğmesinin altında çıktı, odak body'ye düştü, h1 değişmedi (crops/checkout/p11-pay-after-expiry.png). Sayfa yenilendikten sonra da yine 'tutuluyor' ve geçmiş saat 'Oda sizin için 00:30'e kadar tutuluyor' gösterildi (p11-reload-after-expiry.png). API 4 dk sonra hâlâ status=HELD döndürüyordu (p11b-status.mjs). Ayrıca tutma metni düz bir <p>: role ya da aria-live yok, geri sayım yok. Mobilde y=927px'te kalıyor, ilk ekranın dışında (p16-mobile-layout.mjs). 3DS ekranında ise tamamen kayboluyor (p7: hold: []). KOD: BookingActions.tsx:268-272 yalnızca f.time(holdExpiresAt) gösteriyor. booking/[id]/page.tsx:117 başlığı yalnız sunucunun status alanından seçiyor ve holdExpiresAt ile şimdiki zamanı karşılaştırmıyor.

**Etki:** Misafir odanın tutulduğuna inanıp ödemeye çalışıyor ve süre dolduğunda ancak gömülü bir hata görüyor. Yeniden ayırtmak için bir yol da sunulmuyor. Ekran okuyucu kullanıcısı süre sınırından hiç haberdar edilmiyor.

**Önerilen aksiyon:** Tutma bilgisi ödeme bölümünün en üstüne, sayfa başlığının hemen altına taşınsın ve kalan dakikayı gösteren bir sayaç eklensin ('Odanız 12 dk daha tutuluyor'). 5 ve 1 dakika kala role=status ile uyarı verilsin. İstemcide now > holdExpiresAt olduğunda status EXPIRED gibi ele alınsın: t('status.EXPIRED') başlığı gösterilsin, kart formu gizlensin ve 'Aynı tarihleri yeniden ayırt' bağlantısı (checkout URL'i) sunulsun. Bu çözüm idempotency düzeltmesiyle birlikte uygulanmalı.

**Yapılan düzeltme:** The hold notice now sits above every HELD branch (mock, Stripe, 3DS) with a 'Kalan süre: m:ss' counter that updates every second and is not a live region. Warnings are announced once each at 5 and 1 minutes. When time runs out on the client, or the server returns HOLD_EXPIRED, every payment form is hidden and the page shows 'Tutma süresi doldu' with a link to /search. Not done because they belong to other teams: changing the page h1 to EXPIRED, and a rebook link with the same parameters (the component does not have them). — dosyalar: `src/components/booking/BookingActions.tsx`

## F105 — Ödeme durum değişimleri duyurulmuyor ve odak body'ye düşüyor: işleniyor, 3DS ekranı, red ve onay

| Alan                | Değer                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| Severity            | High                                                                               |
| Durum               | Gözlemlendi                                                                        |
| Konum               | `src/components/booking/BookingActions.tsx:314`                                    |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx`, `src/app/checkout/page.tsx`                       |
| Kullanıcılar        | misafir                                                                            |
| Prensip             | accessibility · Observability ve feedback: her eylemin sonucu algılanabilir olmalı |
| Sezgisel madde      | H12 — Feedback                                                                     |
| WCAG                | 4.1.3 Status Messages (AA), 2.4.3 Focus Order (A)                                  |
| Renk/tema           | Hayır                                                                              |
| Efor                | M                                                                                  |
| Kaynak denetçiler   | runtime:checkout                                                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                           |

**Kanıt:** RUNTIME p6-decline.mjs (masaüstü): odak 'Öde ve onayla' üzerindeyken Enter'a basıldı, 150 ms sonra odak body'de ve düğme disabled 'İşleniyor...' durumundaydı. Red mesajı geldiğinde de odak body'de kaldı. p7-3ds.mjs (mobil): kart formu yerini 3DS formuna bıraktığında odak body'de, yeni form için canlı bölge yok. p7b-3ds-recover.mjs (mobil): doğru kod sonrası h1 'Rezervasyonunuz onaylandı' oldu ama odak body'de, main role=status/alert yok (live msgs: []), h1 görünümün dışında kaldı (h1Top=-198, scrollY=367) ve ekran ortasında 'Mesajlar' bölümü vardı. p5 masaüstünde de onay sonrası görünüm iptal düğmesinin bulunduğu bölgede kaldı (crops/checkout/p5-retry-s-0.png). Checkout'ta da ağ hatası sonrası odak body'de (p12). KOD: busy sırasında disabled={busy} (BookingActions.tsx:315,336; checkout/page.tsx:232). onChanged→load() başlığı yerinde değiştiriyor, odak ya da duyuru yönetimi yok (booking/[id]/page.tsx:117).

**Etki:** Ekran okuyucu kullanıcısı ödemenin işlendiğini, 3DS istendiğini ya da rezervasyonun onaylandığını duymuyor. Odak sayfanın başına düştüğü için bağlamı yeniden aramak zorunda kalıyor. Gören kullanıcı ise onay başlığını görmeden altındaki iptal ve iade formlarıyla karşılaşıyor.

**Önerilen aksiyon:** Busy durumunda düğmede aria-disabled='true' kullanılsın ve tıklama engellensin, böylece odak korunur. 3DS formu açıldığında h2'ye tabIndex=-1 ile focus() verilsin. Onayda sayfa başlığına scrollIntoView ve focus() uygulansın, ayrıca role=status ile 'Ödeme alındı, rezervasyonunuz onaylandı. Rezervasyon no: …' duyurulsun. Red ya da hata durumunda odak ilgili alana ya da hata özetine taşınsın.

**Yapılan düzeltme:** Submit buttons use aria-disabled plus aria-busy instead of disabled, and busyRef blocks double submits, so focus stays put. Focus goes to the code field when 3DS opens. On a field error, focus goes to the field; on a decline from 3DS, to the card number. Payment success is announced through role=status. Not done: moving focus and scrolling to the h1 on confirmation (booking/[id]/page.tsx, another team). — dosyalar: `src/components/booking/BookingActions.tsx`

## F106 — Passkey adım-yukarı diyaloğu: odak tuzağı yok, arka plan inert değil, kapanınca odak geri dönmüyor, vazgeçme sessiz

| Alan                | Değer                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                      |
| Durum               | Gözlemlendi                                                                                                                               |
| Konum               | `src/components/booking/StepUpDialog.tsx:28`                                                                                              |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx`                                                                                               |
| Kullanıcılar        | misafir                                                                                                                                   |
| Prensip             | accessibility · Dialog initiative ve observability: modal diyalog kullanıcıyı diyalog içinde tutmalı ve kapanınca bağlama geri döndürmeli |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                     |
| WCAG                | 2.4.3 Focus Order (A), 4.1.2 Name, Role, Value (A: aria-modal=true ama arka plan erişilebilir)                                            |
| Renk/tema           | Hayır                                                                                                                                     |
| Efor                | M                                                                                                                                         |
| Kaynak denetçiler   | runtime:checkout                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutC)                                                                                                  |

**Kanıt:** RUNTIME probes/checkout/p8-stepup.mjs: yalnız POST /pay çağrısı, sunucunun gerçek STEP_UP_REQUIRED gövdesiyle (pay.ts:170) stub'landı. Masaüstü TR, b3. Açılışta odak 'Passkey ile doğrula' düğmesinde (olumlu). Tab x5 sırası: 'Vazgeç' [in dialog], ardından 'Konaklamayı Görüntüle', 'Rezervasyonlarım', 'Yazdır', 'Yardım Merkezi' [OUTSIDE]. Arka plan durumu: mainInert=false, aria-hidden yok, body overflow visible. Escape ile kapandıktan sonra odak 'Yardım Merkezi' footer bağlantısında kaldı ve tetikleyiciye dönmedi. Doğrula tıklanınca POST /api/auth/step-up/options 400 döndü, hata role=alert ile gösterildi ama odak body'ye düştü. 'Vazgeç' sonrasında odak body'de kaldı, msgs:[] (ödemenin yapılmadığına dair bilgi yok). Mobil EN'de aynı sonuç (p8-stepup.mjs b6 mobile en). Ekran görüntüleri: crops/checkout/p8-stepup-desktop-tr-open.png, p8-stepup-desktop-tr-error.png. Hatanın yanında tek yol '/account' bağlantısı; bu bağlantı ödeme sayfasını terk ettiriyor.

**Etki:** Klavye ve ekran okuyucu kullanıcısı modalın arkasındaki karartılmış öğelerde kayboluyor. Diyalog kapandığında sayfadaki yerini kaybediyor. Vazgeçen kullanıcı ödemenin alınmadığını bilmiyor.

**Önerilen aksiyon:** Diyalog açıkken main, header ve footer'a inert verilsin (ya da Radix/Headless UI Dialog kullanılsın), Tab ve Shift+Tab diyalog içinde döngüye alınsın. Açılmadan önceki document.activeElement saklansın, kapanışta (Escape, Vazgeç, başarı) ona focus() verilsin. Busy durumunda düğmede disabled yerine aria-disabled kullanılsın. onCancel sonrasında role=status ile 'Ödeme tamamlanmadı; ek doğrulama gerekli' yazılsın. Passkey başarısız olursa ödeme sayfasından ayrılmadan '3D Secure ile devam et' alternatifi sunulsun.

**Yapılan düzeltme:** StepUpDialog.tsx now uses a native <dialog> opened with showModal(). The browser supplies the focus trap, makes main/header/footer inert and turns Escape into a cancel event. Escape and Vazgeç are blocked while the passkey check is busy (preventDefault plus busyRef). On unmount, focus goes back to the element that was active before the dialog opened. Both buttons use aria-disabled instead of disabled, so focus no longer drops to body during busy or after an error. The account link opens in a new tab so the guest stays on the payment page. Not done here: the role=status message after cancelling ('Ödeme tamamlanmadı') belongs to BookingActions, see crossOwner. A 3D Secure alternative needs a backend change. — dosyalar: `src/components/booking/StepUpDialog.tsx`

## F160 — Tutma süresi yalnız mock formda statik saat olarak görünüyor; geri sayım, uyarı ve süre dolunca yol yok

| Alan                | Değer                                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                        |
| Durum               | Aday (3 kaynak birleşti)                                                                                                                                                                                                                                                                                    |
| Konum               | `src/components/booking/BookingActions.tsx:268`                                                                                                                                                                                                                                                             |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:250-263`, `src/components/booking/BookingActions.tsx:323-341`, `src/lib/payment/pay.ts:40`, `src/components/booking/BookingActions.tsx:250`, `src/app/checkout/cart/page.tsx:292`, `src/app/booking/[id]/page.tsx:117`, `src/app/checkout/cart/page.tsx:292-296` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                     |
| Prensip             | robustness · observability                                                                                                                                                                                                                                                                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                                                                                                                              |
| WCAG                | 2.2.1                                                                                                                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                       |
| Efor                | M                                                                                                                                                                                                                                                                                                           |
| Kaynak denetçiler   | area:checkout, lens:status, lens:forms                                                                                                                                                                                                                                                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                                                                                                                                                                                    |

**Kanıt:** BookingActions.tsx:268-272 `{holdExpiresAt && (<p className="text-sm text-amber-700">{t("holdUntil", { time: f.time(holdExpiresAt) })}</p>)}` yalnızca mock form dalında. Stripe dalında (:250-263) ve 3DS adımında (:323-341) gösterilmiyor. Süre 15 dakika (app-config.ts:53). Geri sayım, son dakika uyarısı ya da uzatma seçeneği yok. Süre dolduğunda form etkin kalıyor ve sunucu pay.ts:40 "Rezervasyon tutma süresi doldu" (HOLD_EXPIRED) döndürüyor; bu metin ham olarak basılıyor ve yeniden rezervasyon bağlantısı yok.

**Etki:** Stripe kullanan ya da 3DS adımındaki misafir süre sınırını hiç görmüyor. Yavaş yazan veya düşük okuryazarlıktaki kullanıcı süreyi kaçırıyor, kartını girip ret alıyor ve akışa nasıl döneceğini bilmiyor.

**Önerilen aksiyon:** Süre bildirimini tüm HELD dallarının üstüne taşıyın. Saniyede bir güncellenen görünür "Kalan süre: 12:34" metni ekleyin (aria-live kapalı). 5. ve 1. dakikada `role="status"` ile bir kez duyuru yapın. Süre dolunca formu gizleyip "Tutma süresi doldu" metni ve aynı parametrelerle "Yeniden rezervasyon yap" bağlantısı gösterin. İş kuralı izin veriyorsa "Süreyi uzat" seçeneği sunun.

**Yapılan düzeltme:** Duplicate of F104. Same changes: counter, 5- and 1-minute announcements, expired view and a rebook link to /search. 'Extend hold' needs a product/backend decision, and a link with the same booking parameters needs data from the page. — dosyalar: `src/components/booking/BookingActions.tsx`

## F169 — Kart formu hataları ilgili alana bağlı değil; hangi alanın hatalı olduğu belirtilmiyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/booking/BookingActions.tsx:160`                                                                                                                                                                                                                                                                                                                                                                      |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:273-305`, `src/components/booking/BookingActions.tsx:363-370`, `src/lib/payment/card-token.ts:152-160`, `src/app/checkout/cart/page.tsx:114`, `src/app/pay/share/[token]/page.tsx:119`, `src/components/resolution/OpenClaimForm.tsx:41`, `src/components/host/DepositSettings.tsx:118`, `src/app/login/page.tsx:120`, `src/components/booking/WalletCreditOption.tsx:94` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                                                                                                              |
| Prensip             | accessibility · WCAG Hata Tanımlama / Hata Önerisi                                                                                                                                                                                                                                                                                                                                                                   |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                                                                                  |
| WCAG                | 3.3.1                                                                                                                                                                                                                                                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Kaynak denetçiler   | area:checkout, lens:a11y                                                                                                                                                                                                                                                                                                                                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutA)                                                                                                                                                                                                                                                                                                                                                                                    |

**Kanıt:** BookingActions.tsx:160-165 `setMessage({ kind: "error", text: err instanceof CardValidationError ? err.message : t("invalidCard") })`: tüm doğrulama hataları tek bir mesaja dönüşüyor ve bu mesaj :363-369'da, "Rezervasyonu iptal et" düğmesinin altında çiziliyor. Kart numarası (:275-282), son kullanma (:287-292) ve CVC (:298-304) girdilerinde aria-invalid ve aria-describedby yok. Hata olunca odak gönder düğmesinde kalıyor. ui.tsx:47-88'deki `Field` bileşeni hata ve aria-invalid desteği sunduğu hâlde kullanılmıyor.

**Etki:** Misafir, özellikle mobilde, hatanın hangi alanda olduğunu göremiyor. Ekran okuyucu kullanıcısı alanlar arasında gezinirken "geçersiz" bilgisini duymuyor. Para hatasına toleransı düşük kullanıcı aynı hatalı veriyle yeniden deniyor.

**Önerilen aksiyon:** `fieldErrors: { number?, exp?, cvc? }` state'i tutun ve her girdiyi `Field` (ui.tsx:47) ile sarın. Hata metni ilgili alanın altında `id=...-error` ile gösterilsin; girdiye `aria-invalid="true"` ve `aria-describedby` eklensin. Gönderim başarısız olunca ilk hatalı girdiye `ref.focus()` yapılsın. Sağlayıcı reddi gibi alan dışı hatalar düğmenin hemen üstünde ayrı bir özet olarak kalsın.

**Yapılan düzeltme:** Card fields are wrapped in Field with useId-based ids. A fieldErrors state maps CardValidationError.code to its field and adds aria-invalid and aria-describedby to that input. The first invalid field gets focus. The form uses noValidate. Errors that aren't tied to a field (provider decline and similar) show as role=alert above the cancel button. — dosyalar: `src/components/booking/BookingActions.tsx`

## F170 — İptal onayı iade tutarını ve politikayı göstermeden geri alınamaz iptali başlatıyor

| Alan                | Değer                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                        |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                    |
| Konum               | `src/components/booking/BookingActions.tsx:208`                                                                                             |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:165`, `src/lib/support/tools.ts:85`, `src/lib/booking/cancellation.ts:109`, `src/lib/support/tools.ts:85-89` |
| Kullanıcılar        | misafir                                                                                                                                     |
| Prensip             | learnability · predictability (feedforward)                                                                                                 |
| Sezgisel madde      | H13 — Feedforward                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                       |
| Efor                | M                                                                                                                                           |
| Kaynak denetçiler   | area:trips, lens:forms                                                                                                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                    |

**Kanıt:** `if (!window.confirm(t('cancel.confirm'))) return;` metni 'Rezervasyonu iptal etmek istediğinize emin misiniz?' (payment.json:21). İade tutarı ancak geri alınamaz DELETE çağrısından sonra 'İptal edildi. İade: {amount}' olarak geliyor (214-223). Salt okunur iade tahmini zaten var: support/tools.ts:85 'Salt-okur iade tahmini: rezervasyondaki politika anlık görüntüsü + computeRefund'. GET /api/bookings/[id] `policySnapshot` döndürüyor ama page.tsx:16-31 bunu kullanmıyor.

**Etki:** Misafir iadenin %100, %50 ya da 0 olacağını bilmeden iptal ediyor. Sonuç geri alınamaz bir para kaybı olabilir. Bu eylem detay sayfasında doğrudan bulunuyor.

**Önerilen aksiyon:** tools.ts:85'teki tahmini yeniden kullanan bir `GET /api/bookings/{id}/refund-preview` ucu ekle. window.confirm yerine bir dialog göster: 'İade: {amount} (%{percent}). {tarih} sonrasında iade %{x} olur.' Düğmeler: 'Rezervasyonu iptal et' (danger) ve 'Vazgeç'. Dialog açılınca odak Vazgeç'te olsun, Esc ile kapansın.

**Yapılan düzeltme:** Duplicate of F64. The in-page confirm dialog was added; showing the refund amount up front needs a backend refund-preview endpoint. — dosyalar: `src/components/booking/BookingActions.tsx`

## F226 — Ham fetch çağrıları 5 dakikalık erişim token'ı dolunca oturumu yenilemiyor; giriş yapmış kullanıcı checkout'ta girişe atılıyor

| Alan                | Değer                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                             |
| Durum               | Aday                                                                                                             |
| Konum               | `src/app/checkout/page.tsx:104`                                                                                  |
| Diğer konumlar      | `src/app/account/page.tsx:83`, `src/components/property/PropertyCard.tsx:70`, `src/lib/config/app-config.ts:356` |
| Kullanıcılar        | tümü                                                                                                             |
| Prensip             | robustness · task conformance / responsiveness                                                                   |
| Sezgisel madde      | H5 — Hata önleme                                                                                                 |
| Renk/tema           | Hayır                                                                                                            |
| Efor                | M                                                                                                                |
| Kaynak denetçiler   | lens:nav                                                                                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                                                                         |

**Kanıt:** app-config.ts:356 `ACCESS_TOKEN_TTL_SECONDS: int(5 * 60, …)`. api-client.ts apiFetch 401'de `refreshSession()` ile yenileyip yeniden deniyor. checkout/page.tsx:104 ise ham `fetch("/api/bookings", …)` kullanıyor ve 121-125'te 401 gelince `router.replace(`/login?redirect=…`)` yapıyor. Checkout'ta Header yok, dolayısıyla Header'ın apiFetch ile yaptığı fetchCurrentUser yenilemesi de çalışmıyor. account/page.tsx:74,83-84,117,123,142 ve PropertyCard.tsx:70,74 de ham fetch.

**Etki:** İlan ve checkout'ta 5 dakikadan uzun karar veren misafir "Rezervasyonu Tamamla"ya basınca geçerli refresh token'ı olmasına rağmen giriş sayfasına atılıyor. Uygulanan kupon (useState, satır 59) dönüşte kayboluyor. /account doğrudan açıldığında "Kullanıcı bilgileri yüklenemedi" hatası çıkıyor.

**Önerilen aksiyon:** checkout POST /api/bookings çağrısını apiFetch ile yapın (Idempotency-Key header'ı options.headers ile geçer). Yalnız apiFetch yine ApiError 401 fırlatırsa girişe yönlendirin. account/page.tsx'teki 6 çağrıyı ve PropertyCard favori çağrılarını apiFetch'e taşıyın. Kupon kodunu URL'ye (`&coupon=`) yazın ki giriş dönüşünde korunsun.

**Yapılan düzeltme:** The checkout part is fixed: apiFetch is used, and the coupon is carried through login. The return URL has a &coupon= parameter and couponCode starts from searchParams.get('coupon'). The raw fetch calls in account/page.tsx and PropertyCard.tsx belong to other owners and are in crossOwner. — dosyalar: `src/app/checkout/page.tsx`

## F227 — Ön koşullar (giriş, e-posta ve kimlik doğrulama) ancak gönderimde ortaya çıkıyor; çözüm bağlantısı yok

| Alan                | Değer                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                        |
| Durum               | Aday                                                                                                                        |
| Konum               | `src/app/checkout/page.tsx:121`                                                                                             |
| Diğer konumlar      | `src/app/checkout/page.tsx:137`, `src/components/booking/BookingActions.tsx:178-181`, `src/app/api/bookings/route.ts:12-14` |
| Kullanıcılar        | misafir                                                                                                                     |
| Prensip             | learnability · predictability                                                                                               |
| Sezgisel madde      | H13 — Feedforward                                                                                                           |
| Renk/tema           | Hayır                                                                                                                       |
| Efor                | M                                                                                                                           |
| Kaynak denetçiler   | area:checkout                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                                                                                    |

**Kanıt:** checkout/page.tsx:121-126 oturum yoksa gönderim sonrasında `router.replace('/login?redirect=...')` çalışıyor; sayfa açılışında "giriş gerekecek" bilgisi yok. api/bookings/route.ts:12-14 `requireVerifiedEmail` ve `assertIdentityRequirement` 403 EMAIL_NOT_VERIFIED / IDENTITY_VERIFICATION_REQUIRED döndürüyor; checkout :137 bunları yalnızca düz metin olarak basıyor. Ödeme ucu (pay/route.ts:27) da requireVerifiedEmail kullanıyor ve BookingActions.tsx:178-181 aynı şekilde düz metin gösteriyor. Uygulamada /verify-email ve /trust sayfaları var ama bu metinlerden bağlantı verilmiyor.

**Etki:** Misafir tüm özeti inceleyip düğmeye bastıktan sonra engelle karşılaşıyor. E-posta ya da kimlik doğrulamasına nereden ulaşacağını kendi bulmak zorunda kalıyor ve birincil görev duruyor.

**Önerilen aksiyon:** Açılışta `fetchCurrentUser()` (api-client.ts:82) çağırın. Oturum yoksa düğme üstünde "Devam etmek için giriş yapmanız gerekecek" notu ve redirect parametreli giriş bağlantısı gösterin. EMAIL_NOT_VERIFIED için `<Link href="/verify-email?redirect=…">E-postamı doğrula</Link>`, IDENTITY_VERIFICATION_REQUIRED için `<Link href="/trust?redirect=…">Kimliğimi doğrula</Link>` içeren hata bileşeni çizin.

**Yapılan düzeltme:** useSession() runs on page load. When signed out, a note appears above the button ('Devam etmek için giriş yapmanız gerekecek…') with a login link that has a redirect and keeps the coupon. EMAIL_NOT_VERIFIED: the message comes from common.errors and a hint says to open the verification link in the email. IDENTITY_VERIFICATION_REQUIRED: a hint plus a link to /support. The app has no page for resending the verification email and no identity verification page, because /verify-email only works with a token and /trust is an information page, so the suggested links could not be added (needs product decision/backend). — dosyalar: `src/app/checkout/page.tsx`

## F228 — Rezervasyon hunisindeki hata durumları yeniden deneme veya alternatif yol sunmuyor (checkout, fiyat teklifi, rezervasyon detayı)

| Alan                | Değer                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                          |
| Durum               | Aday                                                                                                                                                          |
| Konum               | `src/app/checkout/page.tsx:148`                                                                                                                               |
| Diğer konumlar      | `src/app/checkout/page.tsx:212`, `src/components/booking/BookingWidget.tsx:233`, `src/components/booking/useQuote.ts:57`, `src/app/booking/[id]/page.tsx:103` |
| Kullanıcılar        | misafir                                                                                                                                                       |
| Prensip             | robustness · recoverability                                                                                                                                   |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                         |
| Efor                | S                                                                                                                                                             |
| Kaynak denetçiler   | lens:status                                                                                                                                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                                                                                                                      |

**Kanıt:** checkout/page.tsx:87-89 mülk okuma hatası `setLoadError(t("loadFailed"))` → 148-162 başlık 'Rezervasyon bilgileri eksik' + yalnız 'Ana sayfaya dön' (URL parametreleri sağlam). 212-213 ve BookingWidget.tsx:233-234 teklif hatası yalnız kırmızı metin; useQuote.ts:57 `code` (ör. SOLD_OUT) döndürüyor ama iki bileşen de kullanmıyor; submit (BookingWidget.tsx:249, checkout 232) gerekçesiz disabled. booking/[id]/page.tsx:103-113 'Hata' başlığı + ham mesaj + 'Ana sayfaya dön'.

**Etki:** Mobil ağda tek bir zaman aşımı misafirin tarih/oda seçimini çöpe attırıyor; dolu tarih için alternatif gösterilmiyor; rezervasyon detay hatasında 404 ile ağ hatası ayırt edilmiyor.

**Önerilen aksiyon:** checkout loadError: başlık 'Konaklama bilgileri alınamadı', 'Tekrar dene' (fetch'i yeniden çalıştır) + 'İlana dön' (/property/{propertyId}?checkIn&checkOut&guests). Teklif hatasında 'Fiyatı yeniden hesapla' (refreshKey+1); code==='SOLD_OUT' için 'Bu tarihlerde boş oda yok — takvimden başka tarih seçin' + #price-calendar bağlantısı; disabled submit'e aria-describedby ile gerekçe metni. Rezervasyon detayında 404 için 'Rezervasyon bulunamadı', diğerleri için 'Tekrar dene' + 'Rezervasyonlarım'.

**Yapılan düzeltme:** Checkout: when loading the property fails, the heading is now 'Konaklama bilgileri alınamadı' with 'Tekrar dene' (re-runs the fetch via loadAttempt), '← İlana dön' (/property/{id}?checkIn&checkOut&guests&roomId&ratePlanId) and 'Ana sayfaya dön'. On a quote error there is a 'Fiyatı yeniden hesapla' button (refreshKey+1) and a 'Tarihleri veya odayı değiştir' link. code==='SOLD_OUT' shows its own message. The disabled submit button explains why through aria-describedby. BookingWidget.tsx, useQuote.ts and booking/[id]/page.tsx belong to other owners. — dosyalar: `src/app/checkout/page.tsx`

## F229 — Header'sız sepet/ödeme sayfaları standalone PWA'da çıkışsız kalıyor

| Alan                | Değer                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                            |
| Durum               | Aday                                                                                                                                                                            |
| Konum               | `src/app/checkout/page.tsx:166`                                                                                                                                                 |
| Diğer konumlar      | `src/app/cart/page.tsx:63`, `src/app/checkout/cart/page.tsx:232`, `src/app/pay/share/[token]/page.tsx:178`, `src/lib/pwa/manifest.ts:25`, `src/components/layout/Header.tsx:24` |
| Kullanıcılar        | misafir                                                                                                                                                                         |
| Prensip             | robustness · recoverability                                                                                                                                                     |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                           |
| Efor                | S                                                                                                                                                                               |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutB)                                                                                                                                               |

**Kanıt:** Root layout (layout.tsx:65-69) Header içermiyor, Header her sayfada ayrı render ediliyor. Şu sayfalarda Header hiç yok: checkout/page.tsx:166 `<main id="main" className="mx-auto max-w-3xl px-4 py-8">` (ilana dönüş bağlantısı da yok), cart/page.tsx:63, checkout/cart/page.tsx:232 (geri bağlantısı yalnız tutma öncesinde, :279), pay/share/[token]/page.tsx:178. Header menüsü (Header.tsx:24) '/cart'a götürüyor ama hedef sayfada menü kayboluyor. manifest.ts:25 `display: "standalone"` olduğundan iOS'ta kurulu uygulamada tarayıcı geri düğmesi yok.

**Etki:** Kurulu uygulamada sepet ya da ödeme ekranından ana sayfaya veya ilana dönecek hiçbir kontrol yok, kullanıcı uygulamayı kapatıp açmak zorunda kalıyor. Normal tarayıcıda da 'Sepetim'e geçince menünün kaybolması tutarsız (Heuristic 4).

**Önerilen aksiyon:** Bu dört sayfayı PageShell (ui.tsx:157) ile sar ya da Header'ı root layout'a taşı. Checkout'a her durumda '← İlana dön' bağlantısı ekle (`/property/{propertyId}?checkIn=…&checkOut=…&guests=…&roomId=…`). checkout/cart'ta '← Sepete dön' bağlantısını tutma sonrasında da göster. Footer'sız sayfalarda alt bant dolgusunu birlikte test et.

**Yapılan düzeltme:** The checkout page (main page and error state) is wrapped in CheckoutFrame, which renders Header + main + Footer with no new background color. A '← İlana dön' link is always shown above the h1, with min-h 44px and focusRing. The cart, checkout/cart and pay/share pages belong to other owners and are in crossOwner. — dosyalar: `src/app/checkout/page.tsx`

## F230 — Ödeme ekranlarında (checkout, sepet, sepet ödemesi, pay/share) global gezinme, dil seçimi, oturum ve yardım yok

| Alan                | Değer                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                       |
| Durum               | Aday                                                                                                       |
| Konum               | `src/app/checkout/page.tsx:166`                                                                            |
| Diğer konumlar      | `src/app/cart/page.tsx:63`, `src/app/checkout/cart/page.tsx:232`, `src/app/pay/share/[token]/page.tsx:178` |
| Kullanıcılar        | misafir                                                                                                    |
| Prensip             | learnability · consistency                                                                                 |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                |
| Renk/tema           | Hayır                                                                                                      |
| Efor                | S                                                                                                          |
| Kaynak denetçiler   | lens:nav                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutB)                                                                          |

**Kanıt:** checkout/page.tsx:166 `<main id="main" className="mx-auto max-w-3xl px-4 py-8">` ile başlıyor; Header/Footer import edilmemiş. Aynı durum cart/page.tsx:63, checkout/cart/page.tsx:232 ve pay/share/[token]/page.tsx:178'de. Diğer tüm kullanıcı sayfaları Header kullanıyor (PageShell ui.tsx:168). docs/img/checkout-breakdown.png ve v4-cart.png'de yalnız demo şeridi var. Checkout'ta ilana geri dönme bağlantısı yok; bağlantı yalnız hata durumunda 'Ana sayfaya dön' olarak (157-159) çıkıyor.

**Etki:** Ödeme anında misafir TR/EN değiştiremiyor (LocaleSwitcher Header'da), destek ve yardıma ulaşamıyor, hangi hesapla girdiğini göremiyor ve çıkış yapamıyor. Bu, pay/share'de SHARE_EMAIL_MISMATCH durumunda kritik. İlana yalnız tarayıcı geri tuşuyla dönülebiliyor. Header'daki 'Sepetim' öğesi sepette hiç aria-current almıyor.

**Önerilen aksiyon:** Bu dört sayfayı PageShell'e geçirin ya da Header ve Footer ekleyin. Ödeme odaklı sade bir başlık da yeterli: logo, dil seçici, hesap adı ve çıkış, 'Yardım' bağlantısı, '← İlana dön' (`/property/${propertyId}?checkIn…`).

**Yapılan düzeltme:** Same change as F229. Checkout now has Header (language switcher, account and sign-out, navigation) and Footer, plus a return link to the property. The other three pages are in crossOwner. — dosyalar: `src/app/checkout/page.tsx`

## F231 — Checkout özetinde seçilen fiyat planı, iade edilebilirlik ve iptal politikası yok

| Alan                | Değer                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Severity            | High                                                              |
| Durum               | Aday                                                              |
| Konum               | `src/app/checkout/page.tsx:172`                                   |
| Diğer konumlar      | `src/app/checkout/page.tsx:11-16`, `src/app/checkout/page.tsx:52` |
| Kullanıcılar        | misafir                                                           |
| Prensip             | robustness · task conformance                                     |
| Sezgisel madde      | H5 — Hata önleme                                                  |
| Renk/tema           | Hayır                                                             |
| Efor                | M                                                                 |
| Kaynak denetçiler   | area:checkout                                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                          |

**Kanıt:** checkout/page.tsx:11-16 `interface CheckoutProperty { ... rooms: Array<{ id: string; name: string; bedType: string }> }` ratePlans alanını içermiyor. :52 `ratePlanId` yalnızca API'ye iletiliyor (:115). :172-203'teki dl yalnızca konaklama, konum, oda, tarih ve misafir satırlarını gösteriyor. Oysa properties/[id]/route.ts:42-50 her oda için `ratePlans { name, mealPlan, refundable }` döndürüyor ve booking-service.ts:522-525 iade edilemez planı `DEFAULT_POLICIES.NON_REFUNDABLE` ile bağlıyor.

**Etki:** Misafir taahhüt vermeden önceki son ekranda iade edilemez ya da kahvaltısız bir planı seçtiğini göremiyor. Sonradan iptal ettiğinde para kaybediyor. Parasal hata toleransı en düşük adım bu.

**Önerilen aksiyon:** CheckoutProperty.rooms tipine `ratePlans` ekleyin ve `room.ratePlans.find(p => p.id === ratePlanId) ?? isDefault` ile planı bulun. dl'ye "Fiyat planı: {name}", "İade: İade edilemez / Ücretsiz iptal" ve "Kahvaltı dahil" satırlarını ekleyin. Toplamın altına politikanın kısa özetini ("{date} tarihine kadar ücretsiz iptal") yazın.

**Yapılan düzeltme:** A ratePlans field was added to CheckoutProperty.rooms. The plan is found by ratePlanId, falling back to isDefault or the first plan. A 'Fiyat seçeneği' row in the summary dl shows the plan name, refundable/non-refundable and 'Kahvaltı dahil'. The policy summary with a date ('X tarihine kadar ücretsiz iptal') needs freeCancellationUntil in the quote response (needs backend/API change). — dosyalar: `src/app/checkout/page.tsx`

## F232 — Checkout özetinde fiyat planı/iade edilebilirlik yok, tarihler ham ISO biçiminde

| Alan                | Değer                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                    |
| Durum               | Aday                                                                                                    |
| Konum               | `src/app/checkout/page.tsx:196`                                                                         |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:203-230`, `src/components/booking/BookingActions.tsx:265-321` |
| Kullanıcılar        | misafir                                                                                                 |
| Prensip             | robustness · observability, task conformance                                                            |
| Sezgisel madde      | H5 — Hata önleme                                                                                        |
| WCAG                | 3.3.4                                                                                                   |
| Renk/tema           | Hayır                                                                                                   |
| Efor                | M                                                                                                       |
| Kaynak denetçiler   | lens:forms                                                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                                                                |

**Kanıt:** src/app/checkout/page.tsx:193-197 `<dd>{checkIn} → {checkOut}</dd>` (ör. "2026-10-20 → 2026-10-22"); özet <dl> :172-203 oda, misafir, konum içeriyor ama seçilen `ratePlanId` (URL :52) için plan adı, 'İade edilemez' / kahvaltı bilgisi yok. Bu bilgi yalnızca önceki ekranda src/components/booking/BookingWidget.tsx:219-224 `plan.refundable ? t("widget.refundable") : t("widget.nonRefundable")` gösteriliyor; ödeme ekranı (BookingActions) da politikayı göstermiyor.

**Etki:** Para ve tarih hatasına toleransı düşük misafir, 'Rezervasyonu Tamamla' anında iadesiz planı seçtiğini ve tarihleri yerel biçimde doğrulayamaz; yanlış tarih/plan sonradan iadesiz iptale dönüşür (WCAG 3.3.4 gözden geçirme).

**Önerilen aksiyon:** Checkout özetine `f.date(checkIn, "long")` – `f.date(checkOut, "long")` + gece sayısı satırı ve 'Fiyat planı: {ad} · İade edilemez / {tarih}'e kadar ücretsiz iptal' satırı ekle (quote yanıtına plan adı/refundable/freeCancellationUntil ekleyerek). İadesiz planda gönder düğmesinin hemen üstüne ikon+metin uyarı koy.

**Yapılan düzeltme:** Dates now show as f.date(…,'long') – f.date(…,'long') with a night count below (ICU plural). The plan and refund line is the same as F231. The free cancellation date is missing because the quote does not return it (needs backend). — dosyalar: `src/app/checkout/page.tsx`

## F233 — Tarih biçimleri tutarsız: checkout'ta ham ISO, dört farklı stil, EN'de belirsiz en-US sayısal tarih

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                    |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                    |
| Konum               | `src/app/checkout/page.tsx:196`                                                                                                                                                                                                                                                                                                                                         |
| Diğer konumlar      | `src/components/host/PartyRiskPanel.tsx:63`, `src/components/compliance/ComplianceDashboard.tsx:137`, `src/components/search/SmartFilter.tsx:60-62`, `src/app/search/page.tsx:289`, `src/app/compare/page.tsx:99`, `src/components/transfers/TransferMarket.tsx:69`, `src/components/plan/TripPlanner.tsx:187`, `src/lib/i18n/format.ts:8`, `src/lib/i18n/format.ts:17` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                    |
| Prensip             | learnability · consistency                                                                                                                                                                                                                                                                                                                                              |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                                                                                                                                                                                                                                                                                                                                |

**Kanıt:** checkout/page.tsx:196 `{checkIn} → {checkOut}` → ekranda '2026-10-29 → 2026-11-01' (docs/img/checkout-breakdown.png). PartyRiskPanel.tsx:63 aynı ham ISO; ComplianceDashboard.tsx:137 `td.slaDueAt.slice(0, 16).replace("T", " ")`; SmartFilter.tsx:60-62 çiplere ham ISO. Aynı konaklama tarihleri search/page.tsx:289 ve compare/page.tsx:99'da 'short' (29.10.2026), SearchBar/cart'ta 'medium', account/booking detayında 'long'. lib/i18n/format.ts:8 EN→'en-US' ve 17 short=`{ day:'2-digit', month:'2-digit' }` → EN'de '10/29/2026'; EN metinler ise İngiliz yazımı (favourites, Licence) kullanıyor.

**Etki:** Tarih hatası toleransı çok düşük olan misafir ödeme öncesi son kontrol ekranında makine biçimi görür; Avrupalı EN kullanıcı '10/11/2026'yı 10 Kasım/11 Ekim olarak karıştırabilir.

**Önerilen aksiyon:** Misafire görünen tüm konaklama tarihlerinde f.date(..., 'medium') + hafta günü (ör. 'Per, 29 Eki 2026') kullanın; checkout, PartyRiskPanel, SmartFilter çipleri ve uyum paneline f.date/f.dateTime uygulayın; 'short' sayısal stili misafir ekranlarından kaldırın veya EN için 'en-GB' ya da ay adlı biçim seçin.

**Yapılan düzeltme:** Raw ISO dates were removed from checkout and replaced with f.date 'long'. PartyRiskPanel, ComplianceDashboard, SmartFilter, search/compare and the EN locale choice in format.ts (en-US vs en-GB) belong to other owners or need a product decision, so they are in crossOwner. — dosyalar: `src/app/checkout/page.tsx`

## F234 — 'Rezervasyonu Tamamla' düğmesi rezervasyonu tamamlamıyor; ödeme adımının geleceğini haber vermiyor

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | High                                                           |
| Durum               | Aday                                                           |
| Konum               | `src/app/checkout/page.tsx:235`                                |
| Diğer konumlar      | `messages/tr/checkout.json:10`, `messages/en/checkout.json:10` |
| Kullanıcılar        | misafir                                                        |
| Prensip             | learnability · predictability (feedforward)                    |
| Sezgisel madde      | H13 — Feedforward                                              |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:checkout                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutB)                       |

**Kanıt:** checkout/page.tsx:235 `{submitting ? t("processing") : t("title")}` → checkout.json:10 "Rezervasyonu Tamamla". Sayfa başlığı (h1, :167) ile düğme aynı metni taşıyor. handleSubmit (:104-141) yalnızca HELD durumda bir rezervasyon yaratıp `/booking/{id}` sayfasına gidiyor. Orada h1 "Oda sizin için tutuluyor — ödemeyi tamamlayın" diyor (booking.json status.HELD) ve tutma süresi 15 dakika (app-config.ts:53 BOOKING_HOLD_TTL_MINUTES). Checkout sayfasında ödemenin bir sonraki adımda olduğuna ya da süre sınırına dair tek bir metin yok.

**Etki:** Misafir düğmeye basınca işlemin bittiğini sanıyor ve ödeme sayfasını "tamamlandı" ekranı gibi okuyup ayrılabiliyor; tutma süresi dolup rezervasyon düşüyor. Zihinsel model ile sistem durumu çelişiyor.

**Önerilen aksiyon:** Düğme metnini "Odayı tut ve ödemeye geç" (EN: "Hold room and continue to payment") yapın. Düğmenin üstüne şu metni ekleyin: "Odanız 15 dakika sizin için tutulur. Ödemeyi bir sonraki adımda yapacaksınız; şu an ücret alınmaz." Süre sabit yazılmasın, yapılandırmadan gelsin.

**Yapılan düzeltme:** Feedforward text added above the button: 'Bu düğme odayı kısa bir süre sizin için tutar; şu an ücret alınmaz. Ödemeyi bir sonraki adımda yapacaksınız.' It is linked to the button with aria-describedby. The button text 'Rezervasyonu Tamamla' was kept because e2e tests depend on it (helpers.ts:92, a11y.spec.ts:62,264). The hold time (BOOKING_HOLD_TTL_MINUTES) only exists in server config and does not reach the client, so the duration is not shown as a number. If the button label is changed later, those three test lines need updating. — dosyalar: `src/app/checkout/page.tsx`

## F235 — Kart formlarında son kullanma tarihi '12/30' önceden dolu; biçim/uzunluk öznitelikleri eksik ve 4 ekranda tutarsız

| Alan                | Değer                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                        |
| Durum               | Aday                                                                                                                                                                                        |
| Konum               | `src/components/booking/BookingActions.tsx:51`                                                                                                                                              |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:36,297-330`, `src/app/pay/share/[token]/page.tsx:33,240-273`, `src/components/transfers/ClaimForm.tsx:34-39,104-160`, `src/lib/payment/card-token.ts:56-61` |
| Kullanıcılar        | misafir                                                                                                                                                                                     |
| Prensip             | learnability · consistency, error prevention                                                                                                                                                |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                            |
| WCAG                | 3.3.2                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                       |
| Efor                | M                                                                                                                                                                                           |
| Kaynak denetçiler   | lens:forms                                                                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                                                                    |

**Kanıt:** src/components/booking/BookingActions.tsx:51 `useState({ number: "", exp: "12/30", cvc: "" })`; aynı ön değer src/app/checkout/cart/page.tsx:36 ve src/app/pay/share/[token]/page.tsx:33. Son kullanma input'u (BookingActions.tsx:287-292) `inputMode`, `maxLength`, `placeholder="AA/YY"` içermiyor; kart no ve CVC'de `maxLength`/`pattern` yok (:275-283, :297-303). src/components/transfers/ClaimForm.tsx:34-39,122-147 aynı veriyi iki ayrı `type=number` alanla (Ay/Yıl, varsayılan 12 / yıl+2) istiyor. CardValidationError metinleri yalnız TR (src/lib/payment/card-token.ts:56-61) ve hata alanın altında değil, formun dibinde.

**Etki:** Mobil misafir son kullanma alanını dolu görüp atlayabilir; gerçek kartta tarih uyuşmazlığı ret/3DS hatası doğurur ve hangi alanın yanlış olduğu belirtilmez. Dört ödeme ekranı farklı davrandığı için öğrenilen kalıp aktarılamıyor.

**Önerilen aksiyon:** Tek bir <CardFields> bileşeni çıkar ve dört ekranda kullan: exp boş başlasın, `placeholder="AA/YY" inputMode="numeric" maxLength={5} autoComplete="cc-exp"` + otomatik '/' ekleme; kart no `inputMode="numeric" autoComplete="cc-number" maxLength={23}` + 4'lü gruplama; CVC `maxLength={4} pattern="\d{3,4}"`. CardValidationError'ı alan anahtarıyla (number/exp/cvc) fırlat ve Field `error` ile ilgili alana bağla; mesajları çeviri anahtarına taşı.

**Yapılan düzeltme:** In BookingActions: expiry starts empty, auto-inserts '/', and has maxLength=5, inputMode=numeric and the hint 'AA/YY, ör. 08/28'. Card number has maxLength=23; CVC has maxLength=4. Error texts come from the payment.errors.<code> keys. The other three screens and a shared CardFields component belong to other teams. — dosyalar: `src/components/booking/BookingActions.tsx`

## F236 — Ödeme hata metinleri yalnız Türkçe; EN arayüzde çevrilmeden gösteriliyor

| Alan                | Değer                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                                                                   |
| Konum               | `src/components/booking/BookingActions.tsx:79`                                                                                                                                                                                                         |
| Diğer konumlar      | `src/app/checkout/page.tsx:131`, `src/app/checkout/page.tsx:137`, `src/lib/payment/card-token.ts:154`, `src/lib/auth/passkey-client.ts:85`, `src/lib/payment/mock-psp.ts:48`, `src/lib/api-client.ts:40`, `src/components/booking/StepUpDialog.tsx:44` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                |
| Prensip             | robustness · recoverability (anlaşılır hata mesajı) / familiarity                                                                                                                                                                                      |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                    |
| WCAG                | 3.1.2                                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                  |
| Efor                | M                                                                                                                                                                                                                                                      |
| Kaynak denetçiler   | area:checkout                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                                                                                                                               |

**Kanıt:** BookingActions.tsx:79 `text: err instanceof ApiError ? err.message : fallback` ve :180 aynı desen, sunucunun ham `error` metnini basıyor. Sunucu metinleri sabit Türkçe: payment-core.ts:71 "Ödeme reddedildi. Lütfen başka bir kart deneyin.", pay.ts:40 "Rezervasyon tutma süresi doldu", errors.ts:42 "Bu işlem için e-posta adresinizi doğrulamanız gerekiyor". İstemci tarafı da sabit Türkçe: card-token.ts:154 `new CardValidationError("Kart numarası geçersiz")` (BookingActions.tsx:163'te gösterilir), passkey-client.ts:85 "Passkey işlemi iptal edildi veya zaman aşımına uğradı" (StepUpDialog.tsx:44), mock-psp.ts:48 `hint: "Demo doğrulama kodu: ..."` (BookingActions.tsx:326), api-client.ts:40 `İstek başarısız (${res.status})`. checkout/page.tsx:131 ve :137 `throw new Error(data.error ?? t("createFailed"))` aynı sorunu taşıyor. Karşılaştırma: src/app/pay/share/[token]/page.tsx:43-60 `switch (err.code)` ile kodları t() anahtarlarına eşliyor, yani projede doğru desen zaten var.

**Etki:** EN arayüzü kullanan misafir (yabancı turist) ödeme adımında kart reddi, tutma süresinin dolması ya da e-posta doğrulama hatasını Türkçe görüyor ve ne yapması gerektiğini anlayamıyor. EN sayfadaki Türkçe metinde lang="tr" yok, bu yüzden ekran okuyucu metni İngilizce telaffuzla okuyor.

**Önerilen aksiyon:** BookingActions ve checkout/page.tsx'e pay/share sayfasındakine benzer bir `errorText(err)` yardımcısı ekleyin. Bu yardımcı err.code değerini payment.errors.<KOD> / checkout.errors.<KOD> anahtarlarına eşlemeli: PAYMENT_DECLINED, HOLD_EXPIRED, PAYMENT_ATTEMPTS_EXCEEDED, PAYMENT_IN_PROGRESS, PAYMENT_PROVIDER_ERROR, INVALID_CARD_TOKEN, FRAUD_BLOCKED, EMAIL_NOT_VERIFIED, IDENTITY_VERIFICATION_REQUIRED, SOLD_OUT, ROOM_BUSY, TRANSACTION_CONFLICT, RATE_LIMITED, UNAUTHORIZED. Bilinmeyen kodda ham mesaj yerine t("failed") gösterilsin. CardValidationError'a `field: "number"|"cvc"|"expiry"` alanı eklenip metin UI'da çevrilsin. passkeyErrorMessage bir t fonksiyonu alsın. 3DS ipucu `payment.threeDsHint` anahtarından `{code}` parametresiyle üretilsin.

**Yapılan düzeltme:** Added errorText(err, fallback). It returns common.errors.network for network errors. Otherwise it maps codes to payment.errors.<KOD>, then common.errors.<KOD>, then the fallback; raw server text is never shown. Card validation errors are translated by code. For mock 3DS the hint comes from payment.threeDsDemoHint({code}). checkout/page.tsx and passkey-client belong to other teams. — dosyalar: `src/components/booking/BookingActions.tsx`

## F237 — RNPL seçip geri dönünce cüzdan kredisi kutusu boş görünüyor ama kredi yine de kullanılıyor

| Alan                | Değer                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                              |
| Durum               | Aday                                                                                                                                                              |
| Konum               | `src/components/booking/BookingActions.tsx:91`                                                                                                                    |
| Diğer konumlar      | `src/components/booking/WalletCreditOption.tsx:136`, `src/components/booking/WalletCreditOption.tsx:157-162`, `src/components/booking/BookingActions.tsx:239-249` |
| Kullanıcılar        | misafir                                                                                                                                                           |
| Prensip             | robustness · observability (görünen durum ile gerçek durum uyumsuz)                                                                                               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                             |
| Efor                | S                                                                                                                                                                 |
| Kaynak denetçiler   | area:checkout                                                                                                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutA)                                                                                                                                 |

**Kanıt:** BookingActions.tsx:61 `const [creditMinor, setCreditMinor] = useState(0)`. :241 `{status === "HELD" && !challenge && !rnpl && (<WalletCreditOption ...` RNPL seçilince bileşeni unmount ediyor. WalletCreditOption.tsx:136 `const [use, setUse] = useState(false)` yeniden mount edilince işaretsiz başlıyor ama üst bileşendeki creditMinor eski değerinde kalıyor. :91 `...(rnpl ? { paymentOption: "rnpl" } : creditMinor > 0 ? { creditMinor } : {})`. Senaryo: "Kredimi kullan" işaretlenir (₺500) → "Şimdi rezerve et" seçilir → "Şimdi öde"ye dönülür. Kutu boş ve "Kartla ödenecek" satırı görünmüyor, ancak istek creditMinor=50000 ile gidiyor.

**Etki:** Misafirin cüzdan kredisi açık rızası olmadan harcanıyor ve karttan beklediğinden farklı tutar çekiliyor. Para hatasına toleransı düşük kullanıcı için güven kaybı ve destek talebi doğuruyor.

**Önerilen aksiyon:** Kredi durumunu (use, amount) BookingActions'a taşıyıp WalletCreditOption'ı `value`/`onChange` ile kontrollü yapın. Daha kısa çözüm: RnplOption onChange'i `(v) => { setRnpl(v); if (v) setCreditMinor(0); }` olsun ve WalletCreditOption mount olduğunda `onChange(0)` çağırsın. Alternatif olarak bileşeni unmount etmek yerine `hidden` ile gizleyin.

**Yapılan düzeltme:** WalletCreditOption no longer unmounts. It sits in <div hidden={!held || challenge || rnpl}>, so it keeps its state when the guest switches between RNPL and 3DS, and the checkbox always matches the creditMinor that is sent. — dosyalar: `src/components/booking/BookingActions.tsx`

## F238 — Kart son kullanma alanı: biçim hatası 'süresi geçmiş' diye raporlanıyor, '12/30' önceden dolu, hata alana bağlanmıyor

| Alan                | Değer                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                                                                      |
| Konum               | `src/components/booking/BookingActions.tsx:153`                                                                                                                                                           |
| Diğer konumlar      | `src/lib/payment/card-token.ts:59-61`, `src/app/checkout/cart/page.tsx:36`, `src/app/checkout/cart/page.tsx:106`, `src/app/pay/share/[token]/page.tsx:33`, `src/components/transfers/ClaimForm.tsx:34-38` |
| Kullanıcılar        | misafir                                                                                                                                                                                                   |
| Prensip             | robustness · recoverability                                                                                                                                                                               |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                       |
| WCAG                | 3.3.3                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                     |
| Efor                | M                                                                                                                                                                                                         |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                                                                                  |

**Kanıt:** BookingActions.tsx:51 `useState({ number: "", exp: "12/30", cvc: "" })` alan önceden dolu; 153 `const [mm, yy] = card.exp.split("/").map(...)` — kullanıcı '1230' veya '12-30' yazarsa yy=NaN olur ve card-token.ts:59-61 bunu 'Kartın son kullanma tarihi geçmiş' diye raporlar. Hata 364-369'da formun en altında genel <p> olarak çıkar; ilgili input'a aria-invalid/aria-describedby bağlanmaz. Aynı kalıp checkout/cart/page.tsx:36,106 ve pay/share/[token]/page.tsx:33,111'de; transfers ClaimForm.tsx:34-38 ise ayrı Ay/Yıl (4 haneli yıl) alanları kullanır.

**Etki:** Misafir yanlış teşhis edilen hata yüzünden kartının gerçekten süresinin geçtiğini düşünüp ödemeyi bırakabilir; önceden dolu '12/30' fark edilmezse yanlış tarih gönderilir; dört ödeme formunda farklı alan yapısı öğrenmeyi bozar.

**Önerilen aksiyon:** Alanı boş başlatın, placeholder değil görünür ipucu verin ('AA/YY, ör. 08/28'); biçim (EXPIRY_FORMAT) ile geçmiş tarih (CARD_EXPIRED) hatalarını ayırın; hataları ui.tsx Field bileşeninin error prop'u ile ilgili input'a bağlayın (aria-invalid + aria-describedby). Tüm ödeme formlarını tek bir CardFields bileşenine toplayıp aynı AA/YY yapısını kullanın.

**Yapılan düzeltme:** parseExpiry accepts 1230, 12/30, 12-30 and 12/2030. A format error is now reported as errors.EXPIRY_FORMAT, separate from CARD_EXPIRED, and is tied to the field through Field. The field starts empty. The cart, share and ClaimForm screens belong to other teams. — dosyalar: `src/components/booking/BookingActions.tsx`

## F239 — İptal onayı iadeyi göstermiyor; yıkıcı eylemler tarayıcı confirm() ile soruluyor

| Alan                | Değer                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                       |
| Durum               | Aday                                                                                                                                                                                                       |
| Konum               | `src/components/booking/BookingActions.tsx:208`                                                                                                                                                            |
| Diğer konumlar      | `messages/tr/payment.json:21`, `src/app/cart/page.tsx:45`, `src/components/resolution/ClaimDetail.tsx:103`, `src/components/account/SessionManager.tsx:71`, `src/components/account/PasskeyManager.tsx:87` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                         |
| Prensip             | robustness · recoverability (hata önleme)                                                                                                                                                                  |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                           |
| WCAG                | 3.3.4                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                      |
| Efor                | M                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                                                                                   |

**Kanıt:** BookingActions.tsx:208 `if (!window.confirm(t("cancel.confirm"))) return;` → payment.json:21 'Rezervasyonu iptal etmek istediğinize emin misiniz?'; iade tutarı/yüzdesi ancak işlem bittikten sonra 214-222'de gösterilir. confirm() düğmeleri tarayıcı dilinde 'OK/Cancel' olur, fiil içermez. Aynı desen: cart/page.tsx:45 (sepeti boşalt), ClaimDetail.tsx:103 (talebi geri çek), SessionManager.tsx:71, PasskeyManager.tsx:87. Oysa PrivacyCenter (hesap silme) özel, iki aşamalı onay kullanıyor.

**Etki:** Misafir iade alıp almayacağını bilmeden karar verir; iade edilmez planda 'Tamam'a basınca para kaybı. Uygulama TR iken tarayıcı EN ise onay düğmeleri İngilizce çıkar.

**Önerilen aksiyon:** Yeniden kullanılabilir bir ConfirmDialog (role=dialog, odak tuzağı, Esc) yazın; iptalde önce iade önizlemesini getirip gövdede 'İade: ₺X (%Y) — ücretsiz iptal {tarih}'e kadardı' gösterin; düğmeler 'Rezervasyonu iptal et' / 'Rezervasyonu koru'. Diğer confirm() çağrılarını da bu bileşene geçirip fiil ile başlayan düğme metinleri kullanın.

**Yapılan düzeltme:** Duplicate of F64. ConfirmDialog with verb-led buttons was added. The refund preview needs an API. The other confirm() calls (cart, ClaimDetail, SessionManager, PasskeyManager) belong to other teams. — dosyalar: `src/components/booking/BookingActions.tsx`

## F240 — Kart girdilerinin kenarlık kontrastı yetersiz (gray-300, yaklaşık 1,5:1)

| Alan                | Değer                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| Severity            | High                                                                               |
| Durum               | Aday                                                                               |
| Konum               | `src/components/booking/BookingActions.tsx:235`                                    |
| Diğer konumlar      | `src/components/booking/WalletCreditOption.tsx:192`, `src/components/ui/ui.tsx:21` |
| Kullanıcılar        | misafir                                                                            |
| Prensip             | accessibility · Metin dışı kontrast                                                |
| Sezgisel madde      | H14 — Erişilebilirlik                                                              |
| WCAG                | 1.4.11                                                                             |
| Renk/tema           | Evet — onaylandı, sonraki oturumda uygulanacak                                     |
| Efor                | S                                                                                  |
| Kaynak denetçiler   | area:checkout                                                                      |
| **Düzeltme durumu** | **Onaylandı — sonraki oturumda uygulanacak (renk)**                                |

**Kanıt:** BookingActions.tsx:235 `const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";` → #d1d5db / beyaz zemin ≈ 1,48:1, gereken 3:1. Bu sınıf kart numarası, son kullanma, CVC ve 3DS kodu girdilerinde kullanılıyor. WalletCreditOption.tsx:192 da border-gray-300. Paylaşılan inputClass (ui.tsx:21) border-gray-400 kullanıyor (≈2,5:1, o da yetersiz).

**Etki:** Az gören ya da güneş altında mobil kullanan misafir kart alanlarının sınırını seçemiyor ve boş alanı fark etmiyor.

**Önerilen aksiyon:** Renk dışı ara çözüm: her girdinin üstünde görünür etiket zaten var; alanlara `placeholder` ("1234 5678 9012 3456", "AA/YY") ekleyerek alanın varlığını belirginleştirin. Kalıcı çözüm kenarlığı en az 3:1 sağlayan bir mevcut gri tonuna çekmek; bu kullanıcı onayı gerektiren bir renk/tema değişikliği.

## F241 — Ödeme adımı geçişlerinde odak kayboluyor; ödeme ya da iptal başarısı duyurulmuyor

| Alan                | Değer                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                  |
| Durum               | Aday                                                                                                                                  |
| Konum               | `src/components/booking/BookingActions.tsx:265`                                                                                       |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:323`, `src/components/booking/BookingActions.tsx:344`, `src/app/booking/[id]/page.tsx:117` |
| Kullanıcılar        | misafir                                                                                                                               |
| Prensip             | accessibility · Odak sırası / Durum mesajları                                                                                         |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                 |
| WCAG                | 2.4.3                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                 |
| Efor                | M                                                                                                                                     |
| Kaynak denetçiler   | area:checkout                                                                                                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                              |

**Kanıt:** BookingActions.tsx:265 `{status === "HELD" && !useStripeForm && !challenge && (<form ...>`: :171'de `setChallenge(...)` çalışınca form ve odaktaki gönder düğmesi DOM'dan kalkıyor. :323'te `{challenge && (<form ...>` açılan 3DS girdisine odak verilmiyor. Başarıda :172 `onChanged()` → booking/[id]/page.tsx:51-65 yeniden yükleniyor ve :117-119'daki h1 metni "Rezervasyonunuz onaylandı" olarak değişiyor, ama canlı bölge ya da odak taşıma yok. İptal başarısında (:224) iptal düğmesi (:344) kayboluyor ve odak body'ye düşüyor.

**Etki:** Ekran okuyucu ya da yalnız klavye kullanan misafir, ödeme sonrasında odağın belge başına düştüğünü fark ediyor ama "onaylandı" bilgisini duymuyor. Ödemenin olup olmadığını anlayamıyor; tekrar ödemeye çalışabilir ya da sayfadan ayrılabilir.

**Önerilen aksiyon:** 3DS formu açılınca kod girdisine `useEffect(() => codeRef.current?.focus(), [challenge])` uygulayın. booking/[id]/page.tsx'te durum değişince h1'e `tabIndex={-1}` verip `ref.focus()` yapın ve bir `<p role="status">` ile "Ödemeniz alındı, rezervasyonunuz onaylandı" / "Rezervasyon iptal edildi" duyurun. BookingActions'ta `onChanged` çağrısına sonuç türü parametresi (`'paid' | 'cancelled'`) ekleyin.

**Yapılan düzeltme:** Focus moves to the field when 3DS opens. Payment success and cancel results are announced in the role=status region. Cancel results were already shown there, and that region is now always present. Not done: tabIndex=-1 plus focus on the page h1 (another team). — dosyalar: `src/components/booking/BookingActions.tsx`

## F242 — Kart ödeme formu dört yerde kopyalanmış ve birbirinden ayrışmış (alanlar, 3DS etiketi, düğmede tutar)

| Alan                | Değer                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                          |
| Durum               | Aday                                                                                                                                                                                          |
| Konum               | `src/components/booking/BookingActions.tsx:265`                                                                                                                                               |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:323-342`, `src/app/checkout/cart/page.tsx:285-406`, `src/app/pay/share/[token]/page.tsx:233-321`, `src/components/transfers/ClaimForm.tsx:102-162` |
| Kullanıcılar        | misafir                                                                                                                                                                                       |
| Prensip             | learnability · consistency / generalizability                                                                                                                                                 |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                   |
| WCAG                | 3.3.2                                                                                                                                                                                         |
| Renk/tema           | Hayır                                                                                                                                                                                         |
| Efor                | M                                                                                                                                                                                             |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutA)                                                                                                                                                      |

**Kanıt:** 1) BookingActions.tsx:265-320: tek alanda AA/YY (`exp: "12/30"` önceden dolu), ham `<label>`, gönder düğmesi `t("payAndConfirm")` tutarsız; 3DS kodu :327-334 yalnızca `aria-label` ile etiketli, görünür etiket ve `autoComplete="one-time-code"` yok. 2) checkout/cart/page.tsx:285-356: aynı form, düğme `${tp("payAndConfirm")} · ${f.money(cart.totalMinor…)}` tutarı gösteriyor; 3DS :387-396 görünür etiketli ve one-time-code kullanıyor. 3) pay/share/[token]/page.tsx:233-291: aynı form, düğmede tutar var. 4) transfers/ClaimForm.tsx:102-162: ay ve yıl iki ayrı `type="number"` alan (`expYear` 4 hane), Field primitifi kullanılıyor, düğmede tutar yok ("Öde ve devral"), test kartı ipucunda 3DS kartı yok. Çeviriler de çoğaltılmış: payment.cardNumber ile transfers.claim.cardNumber.

**Etki:** Misafir her ödeme bağlamında son kullanma tarihini farklı biçimde girer (AA/YY ile Ay+Yıl). Tutar bazı ekranlarda düğmede görünür, bazılarında görünmez. Cüzdan kredisi ya da RNPL tutarı değiştirdiğinde tek oda ödemesinde son tutar düğmede yazmaz. Ekran okuyucu kullanıcısı 3DS alanını bir akışta görünür etiketle, diğerinde etiketsiz bulur.

**Önerilen aksiyon:** `CardPaymentForm` adlı tek bir bileşen çıkarın. Props: `amountMinor`, `currency`, `submitLabel`, `onToken`, `busy`. Field primitifiyle kart numarası, tek bir AA/YY alanı (`autoComplete="cc-exp"`, `inputMode="numeric"`, varsayılan değer boş) ve CVC alanı olsun. Düğme her zaman "{eylem} · {tutar}" göstersin. Ayrıca görünür etiketli ve one-time-code kullanan bir `ThreeDsForm` bileşeni yapın. Dört kullanım yeri bu bileşenlere geçsin, transfers.claim içindeki kopya çeviri anahtarları silinsin.

**Yapılan düzeltme:** The BookingActions form now uses Field, a single AA/YY field with an empty default, and a 3DS code field with a visible label and autoComplete=one-time-code. Extracting shared CardPaymentForm and ThreeDsForm components and moving all four screens onto them needs other teams. — dosyalar: `src/components/booking/BookingActions.tsx`

## F243 — RNPL plan kartı durumdan bağımsız metin kullanıyor: iptal edilmiş planda 'tahsil edilecek', günler sonra 'Bugün'

| Alan                | Değer                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                      |
| Durum               | Aday                                                                                                      |
| Konum               | `src/components/booking/RnplPlan.tsx:55`                                                                  |
| Diğer konumlar      | `messages/tr/payment.json:48`, `messages/en/payment.json:48`, `src/components/booking/RnplPlan.tsx:66-75` |
| Kullanıcılar        | misafir                                                                                                   |
| Prensip             | robustness · observability                                                                                |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                            |
| Renk/tema           | Hayır                                                                                                     |
| Efor                | S                                                                                                         |
| Kaynak denetçiler   | area:checkout                                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutC)                                                                         |

**Kanıt:** RnplPlan.tsx:55 `<p className="mt-2 font-medium">{t("plan.summary", { today, amount, date: due })}</p>` her durumda çiziliyor. payment.json:48 metni: "Bugün {today} ödendi; {date} tarihinde {amount} kayıtlı kartınızdan tahsil edilecek." Durum CANCELLED (rozet: "İptal — tahsilat yok"), DEFAULTED ya da CAPTURED olsa da kalın özet "tahsil edilecek" diyor. :66-75'teki zaman çizelgesi de her durumda gelecek zamanla gösteriliyor (stepToday "Bugün: … tahsil edilir"). Rezervasyondan günler sonra açıldığında "Bugün" ifadesi yanlış.

**Etki:** Misafir iptal edilmiş planda kartından para çekileceğini, tahsil edilmiş planda ise ikinci bir tahsilat olacağını düşünüyor. Rozet ile özet çelişiyor ve destek yükü artıyor.

**Önerilen aksiyon:** Özeti duruma göre seçin. SCHEDULED: "{date} tarihinde {amount} tahsil edilecek". CAPTURED: yalnızca :61-65'teki captured satırı. CANCELLED: "Plan iptal edildi; tahsilat yapılmayacak". DEFAULTED: "Ödeme alınamadı; rezervasyon iptal edildi". "Bugün" yerine rezervasyon tarihini kullanın ("{createdAt} tarihinde {today} ödendi"). Zaman çizelgesini yalnızca SCHEDULED ve RETRYING durumlarında gösterin.

**Yapılan düzeltme:** In RnplPlan.tsx the summary and timeline now render only when the plan is still unpaid (pending = SCHEDULED or RETRYING). CANCELLED shows plan.summaryCancelled. DEFAULTED shows plan.summaryDefaulted. CAPTURED shows only the existing captured line. 'Bugün' in the summary became 'Rezervasyon sırasında' (plan.summary text updated). The timeline's first step uses the new plan.stepBooked key. stepToday is left unchanged because the checkout option still uses it, where 'Bugün' is correct. There is no createdAt in the plan data, so the date of the first payment is not shown. — dosyalar: `src/components/booking/RnplPlan.tsx`, `tests/unit/ui/rnpl-option.test.ts`

## F244 — Step-up iletişim kutusu odağı içinde tutmuyor, arka planı devre dışı bırakmıyor, kapanınca odağı geri vermiyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | High                                                |
| Durum               | Aday                                                |
| Konum               | `src/components/booking/StepUpDialog.tsx:28`        |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:355-361` |
| Kullanıcılar        | misafir                                             |
| Prensip             | accessibility · Odak sırası / Odak örtülmemeli      |
| Sezgisel madde      | H14 — Erişilebilirlik                               |
| WCAG                | 2.4.11                                              |
| Renk/tema           | Hayır                                               |
| Efor                | M                                                   |
| Kaynak denetçiler   | area:checkout                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutC)                   |

**Kanıt:** StepUpDialog.tsx:28-35 yalnızca `primary.current?.focus()` ve Escape dinleyicisi içeriyor; Tab ve Shift+Tab döngüsü yok. :50 `<div className="fixed inset-0 z-50 ... bg-black/40">` kaplamasının kardeş öğelerine `inert` verilmiyor. Bileşen kapanınca (BookingActions.tsx:359 `setStepUp(null)`) odak tetikleyen düğmeye dönmüyor. Bileşen BookingActions.tsx:355-361'de sayfa içinde, portalsız çiziliyor.

**Etki:** Klavye kullanıcısı iki Tab basışında kaplamanın arkasındaki, yarı saydam siyahla örtülü bağlantı ve düğmelere geçiyor; odak görünmez hâle geliyor. Ekran okuyucunun sanal imleci aria-modal desteği zayıf tarayıcılarda arka plandaki ödeme formuna kaçıyor. Kapanıştan sonra odak body'ye düşüyor.

**Önerilen aksiyon:** Native `<dialog>` öğesine `ref.current.showModal()` uygulayın; bu, odak hapsini, arka planın inert olmasını ve Escape davranışını tarayıcıya bırakır. Alternatif olarak açılışta `const prev = document.activeElement` saklayın, ilk ve son odaklanabilir öğe arasında Tab döngüsü kurun, kapanışta `prev?.focus()` çağırın ve sayfa köküne `inert` verin.

**Yapılan düzeltme:** Same fix as F106: native <dialog> with showModal() for the focus trap and inert background, cancel event for Escape, and focus restored to the trigger on close. — dosyalar: `src/components/booking/StepUpDialog.tsx`

## F245 — StepUpDialog ve ReauthDialog: odak tuzağı, inert arka plan ve kapanışta odak iadesi yok

| Alan                | Değer                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                         |
| Durum               | Aday                                                                                                                                         |
| Konum               | `src/components/booking/StepUpDialog.tsx:28`                                                                                                 |
| Diğer konumlar      | `src/components/account/ReauthDialog.tsx:42`, `src/components/account/ReauthDialog.tsx:159`, `src/components/booking/BookingActions.tsx:355` |
| Kullanıcılar        | tümü                                                                                                                                         |
| Prensip             | accessibility · Dialog (modal) deseni                                                                                                        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                            |
| WCAG                | 2.4.3                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                        |
| Efor                | M                                                                                                                                            |
| Kaynak denetçiler   | lens:a11y                                                                                                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutC)                                                                                                     |

**Kanıt:** StepUpDialog.tsx:28-35 useEffect yalnız `primary.current?.focus()` ve window keydown'da `if (e.key === "Escape") onCancel();` yapıyor; Tab için tuzak yok, arka plan `inert` değil, diyalog portal'sız (BookingActions.tsx:355-361 içinde). Kapanınca odak tetikleyiciye dönmüyor. Escape busy iken de onCancel çağırıyor (31) oysa düğmeler `disabled={busy}` (77, 85). ReauthDialog.tsx:42-49 aynı kalıp; useReauth 159-170 diyaloğu `setPending(null)` ile DOM'dan kaldırıyor ve PasskeyManager.tsx:168, SessionManager.tsx:157, AgentMandates.tsx:227, PrivacyCenter.tsx:118'de bölüm içine gömülü render ediliyor.

**Etki:** Klavye/ekran okuyucu: misafir ödeme step-up'ında ve tüm roller hassas işlemde Tab ile %40 karartılmış arka plandaki bağlantılara kaçar (odak örtü altında kalır, 2.4.11); doğrulama/iptal sonrası odak <body>'ye düşer ve sayfa başından yeniden gezinmek gerekir.

**Önerilen aksiyon:** İki diyaloğu da yerel `<dialog>` + `showModal()` ile yazın (yerleşik odak tuzağı, inert arka plan, Escape → `cancel` olayı); açılışta `document.activeElement`'i saklayıp kapanışta `.focus()` ile geri verin; busy iken `cancel` olayında `preventDefault()`. Alternatif: createPortal + focus-trap + kardeş öğelere `inert`.

**Yapılan düzeltme:** Fixed for StepUpDialog: <dialog> with showModal(), cancel event blocked while busy, focus returned on close. ReauthDialog.tsx is outside my files; see crossOwner. — dosyalar: `src/components/booking/StepUpDialog.tsx`

## F246 — Riskli ödemede yalnız passkey ile doğrulama isteniyor; passkey'i olmayan için yol yok, terim açıklanmıyor

| Alan                | Değer                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| Severity            | High                                                                               |
| Durum               | Aday                                                                               |
| Konum               | `src/components/booking/StepUpDialog.tsx:61`                                       |
| Diğer konumlar      | `messages/tr/payment.json:30`, `src/components/booking/BookingActions.tsx:355-361` |
| Kullanıcılar        | misafir                                                                            |
| Prensip             | robustness · recoverability                                                        |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                                         |
| Renk/tema           | Hayır                                                                              |
| Efor                | M                                                                                  |
| Kaynak denetçiler   | lens:copy                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: checkoutC)                                           |

**Kanıt:** StepUpDialog.tsx:61-63 açıklama payment.json:30 'Hesabınızı korumak için bu ödemeyi passkey'inizle onaylamanızı istiyoruz.' — 'passkey'in ne olduğu ve hiç yoksa ne yapılacağı söylenmez; tek eylem 'Passkey ile doğrula' (80). Hata hâlinde 66-69 `<Link href="/account">Passkey'lerimi yönet</Link>` ödeme akışını terk ettirir; dönüşte BookingActions'taki tutma süresi akmaya devam eder.

**Etki:** Passkey kaydı olmayan misafir riskli bulunan ödemesini tamamlayamaz ve odası tutma süresi dolunca düşer (birincil görev engeli).

**Önerilen aksiyon:** Açıklamaya kısa tanım ekleyin ('Passkey: telefon/bilgisayar kilidiyle (parmak izi, PIN) giriş'); passkey yoksa diyalog içinde 'Bu cihazda passkey oluştur' adımını veya parola + e-posta kodu alternatifini sunun; yönetim bağlantısını yeni sekmede açın ve kalan tutma süresini diyalogda gösterin.

**Yapılan düzeltme:** The dialog now explains what a passkey is (stepUp.whatIsPasskey) and tells guests without one what to do (stepUp.noPasskey). The 'Passkey oluştur veya yönet' link is always visible, opens in a new tab and says so in its text, with a 44px touch target on mobile. A new optional holdExpiresAt prop shows how long the room is still held (stepUp.holdUntil). BookingActions has to pass this prop (crossOwner). A password/email-code or 3DS alternative inside the dialog needs a backend/API change. — dosyalar: `src/components/booking/StepUpDialog.tsx`

## F247 — Stripe formu 'test modu — gerçek ödeme alınmaz' notunu anahtar türüne bakmadan her zaman gösteriyor

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | High                                                                     |
| Durum               | Aday                                                                     |
| Konum               | `src/components/booking/StripePaymentForm.tsx:79`                        |
| Diğer konumlar      | `messages/tr/payment.json:14`, `src/app/api/payments/config/route.ts:15` |
| Kullanıcılar        | misafir                                                                  |
| Prensip             | learnability · predictability                                            |
| Sezgisel madde      | H13 — Feedforward                                                        |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | area:checkout                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: checkoutC)                                        |

**Kanıt:** StripePaymentForm.tsx:79 `<p className="text-xs text-gray-500">{t("stripeTestMode")}</p>` koşulsuz çiziliyor; metin payment.json:14 "Stripe test modu — gerçek ödeme alınmaz.". Yayımlanabilir anahtar ortam değişkeninden geliyor (api/payments/config/route.ts:15 `process.env.STRIPE_PUBLISHABLE_KEY`) ve pk_test_/pk_live_ ayrımı yapılmıyor.

**Etki:** Canlı anahtarla yayına alındığında misafire "gerçek ödeme alınmaz" denip kartından gerçek tahsilat yapılır. Bu, para konusunda yanıltıcı bir bilgi.

**Önerilen aksiyon:** Notu `props.publishableKey.startsWith("pk_test_")` koşuluna bağlayın. Canlı modda yerine "Kartınızdan {amount} tahsil edilecek" bilgisini gösterin.

**Yapılan düzeltme:** StripePaymentForm.tsx shows the stripeTestMode note only when publishableKey starts with pk_test_. Otherwise it shows payment.stripeLiveCharge ('Onayladığınızda kartınızdan {amount} tahsil edilecek', amount formatted with useFormat().money). The submit button got type=submit and aria-busy, and onSubmit returns early while busy to stop double submits. — dosyalar: `src/components/booking/StripePaymentForm.tsx`

## F441 — Son kullanma alanı '12/30' önceden dolu geliyor

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Medium                                                                    |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                           |
| Konum               | `src/components/booking/BookingActions.tsx:51`                            |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:287-292`                       |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | robustness · Hata önleme: ödeme verisinde varsayılan değer kullanılmamalı |
| Sezgisel madde      | H5 — Hata önleme                                                          |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:checkout, area:checkout                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** RUNTIME p4-booking-page.mjs ve p2 ekran görüntüsü (crops/checkout/p2-desktop-booking-s-0.png): kart numarası ve CVC boşken 'Son kullanma (AA/YY)' alanının değeri '12/30'. Tab sırasında 'input "12/30"' olarak görünüyor. Boş gönderimde yalnız numara ve CVC için 'Please fill out this field.' çıkıyor, son kullanma doğrulanmadan geçiyor. KOD: useState({ number: "", exp: "12/30", cvc: "" }).

**Etki:** Kart bilgilerini girerken dolu alanı atlayan misafir yanlış son kullanma tarihiyle ödeme yapar, kart reddedilir ve deneme hakkı (PAYMENT_MAX_ATTEMPTS=5) boşa harcanır.

**Önerilen aksiyon:** exp başlangıç değeri boş olsun, placeholder 'AA/YY' ve inputMode='numeric' kullanılsın, maxLength=5 verilsin, iki rakamdan sonra '/' otomatik eklensin. Demo kolaylığı gerekiyorsa test kartı ipucuna 'herhangi bir gelecek tarih' notu eklensin.

## F494 — Girişe yönlendirme bağlamı kaybediyor: neden açıklanmıyor, Kayıt Ol ve rezervasyon sayfasındaki giriş bağlantısı geri dönüş adresini taşımıyor

| Alan                | Değer                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                       |
| Durum               | Gözlemlendi                                                                                                  |
| Konum               | `src/app/checkout/page.tsx:121`                                                                              |
| Diğer konumlar      | `src/app/login/page.tsx`, `src/app/booking/[id]/page.tsx`                                                    |
| Kullanıcılar        | misafir                                                                                                      |
| Prensip             | learnability · Predictability ve task migratability: görev, kimlik doğrulamadan sonra kaldığı yerden sürmeli |
| Sezgisel madde      | H13 — Feedforward                                                                                            |
| Renk/tema           | Hayır                                                                                                        |
| Efor                | S                                                                                                            |
| Kaynak denetçiler   | runtime:checkout                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                 |

**Kanıt:** RUNTIME p1-anon.mjs: anon checkout'ta girişin gerekli olduğuna dair bir ipucu yok; 'giriş/oturum' metni sayısı 0. Tıklandığında POST 401 dönüyor ve /login?redirect=%2Fcheckout… adresine gidiliyor. Login alt başlığı 'Rezervasyonlarınıza ve favorilerinize erişin.'; rezervasyondan söz edilmiyor; odak body'de. p1c: 'Kayıt Ol' href='/register' (redirect yok). router.replace checkout'u geçmişten siliyor: Geri'ye basınca about:blank açıldı (p1c, checkout ilk sayfa iken). p14-anon-booking.mjs: /booking/{id} anon olarak 'Giriş gerekli' gösteriyor, 'Giriş Yap' href='/login' (redirect yok). Olumlu: p1d'de girişten sonra checkout'a parametreleriyle dönülüyor. KOD: checkout/page.tsx:121-125; login/page.tsx:81 (subtitle), 149 (/register); booking/[id]/page.tsx:80-81.

**Etki:** Yeni misafir hesap açtığında rezervasyon bağlamını kaybediyor. E-postadaki rezervasyon bağlantısından gelen kullanıcı girişten sonra ana sayfaya düşüyor. Neden giriş istendiği anlaşılmıyor.

**Önerilen aksiyon:** Yönlendirmeye ?redirect=…&reason=checkout eklensin; login'de reason=checkout ise 'Rezervasyonu tamamlamak için giriş yapın veya hesap oluşturun' gösterilsin. /register bağlantısı redirect parametresini taşısın. Rezervasyon sayfasındaki giriş bağlantısı '/login?redirect=/booking/{id}' olsun. replace yerine push kullanılsın. Checkout'ta anon kullanıcıya düğme üstünde 'Devam etmek için giriş yapmanız gerekecek' notu gösterilsin.

## F495 — Ağ hatasında checkout İngilizce ham tarayıcı mesajı 'Failed to fetch' gösteriyor

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Medium                                                                      |
| Durum               | Gözlemlendi                                                                 |
| Konum               | `src/app/checkout/page.tsx:142`                                             |
| Kullanıcılar        | misafir                                                                     |
| Prensip             | robustness · Recoverability: hata mesajı anlaşılır olmalı ve yol göstermeli |
| Sezgisel madde      | H9 — Hata mesajları                                                         |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | runtime:checkout                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** RUNTIME p12-checkout-coupon.mjs: POST /api/bookings route.abort('internetdisconnected') ile kesildi. Türkçe arayüzde role=alert 'Failed to fetch' çıktı ve odak body'ye düştü (crops/checkout/p12-network-error.png). KOD: catch(err) içinde setError(err.message) (page.tsx:142-144); TypeError ayırt edilmiyor.

**Etki:** Mobil ağdaki misafir anlamadığı bir İngilizce mesajla karşılaşıyor; rezervasyonun oluşup oluşmadığını ve yeniden denemenin güvenli olup olmadığını bilmiyor.

**Önerilen aksiyon:** TypeError ya da ağ hatası için t('networkError') kullanılsın: 'Bağlantı kurulamadı. İnternetinizi kontrol edip yeniden deneyin; aynı rezervasyon iki kez oluşturulmaz.' Hata kutusuna 'Yeniden dene' düğmesi eklensin.

## F496 — Checkout özetinde site başlığı/geri bağlantısı yok, tarihler ham ISO, seçilen fiyat planı gösterilmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/app/checkout/page.tsx:188`                 |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · User control / Familiarity (Dix) |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | runtime:pdp                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** RUNTIME p5-anon-flow.mjs + runtime/probes/property/p5-coupon-invalid.png: sayfada Header yok (yalnız DEMO şeridi), ilana dönüş/düzenle bağlantısı yok; 'Giriş – Çıkış 2026-10-12 → 2026-10-13', 'Misafir 2'; 'Oda Loft (Çift Kişilik Yatak)' — Standart/İade edilemez planı ve iade koşulu yok. Kod: checkout/page.tsx:162 main (Header import yok), 188-193 ham {checkIn} → {checkOut}, 179-186 yalnız room.name.

**Etki:** Kullanıcı tarih/oda düzeltmek için tarayıcı geri tuşuna mecbur; ISO tarih geniş kullanıcı kitlesi için zor okunur; ödeme öncesi iade koşulunu doğrulayamaz.

**Önerilen aksiyon:** Header (veya sade checkout başlığı + 'İlana dön/Değiştir' bağlantısı) ekleyin; tarihleri f.date(…,'medium') + gece sayısıyla gösterin; seçili plan adı ve iade/iptal metnini özet listesine ekleyin.

## F497 — Checkout bir çıkmaz sokak: üst çubuk ya da geri bağlantısı yok, tarih ve misafir düzenlenemiyor, fiyat hatası kurtarma eylemi sunmuyor

| Alan                | Değer                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                               |
| Durum               | Gözlemlendi                                                                                          |
| Konum               | `src/app/checkout/page.tsx:212`                                                                      |
| Kullanıcılar        | misafir                                                                                              |
| Prensip             | flexibility · Dialog initiative ve recoverability: kullanıcı önceki adıma ve düzenlemeye dönebilmeli |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                    |
| Renk/tema           | Hayır                                                                                                |
| Efor                | S                                                                                                    |
| Kaynak denetçiler   | runtime:checkout                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                         |

**Kanıt:** RUNTIME tarama 010/011/088/089/122/123: landmarks header:0, nav:0, footer:0; masaüstü TR'de Tab sırası yalnız 'İçeriğe geç', kupon, 'Uygula', 'Rezervasyonu Tamamla'. p1-anon'da sayfadaki görünür bağlantı sayısı 1. p13-checkout-errors.mjs (mobil): geçmiş tarihlerde 'Giriş tarihi geçmişte olamaz', 12 misafirde 'Bu oda en fazla 2 kişiliktir' kırmızı metin çıkıyor, düğme disabled ve main içinde bağlantı yok (links: []). Ekran görüntüsü: crops/checkout/p13-too-many-guests.png. Karşılaştırma: rezervasyon sayfası Header ve Footer içeriyor (booking/[id]/page.tsx:99,206). KOD: page.tsx:165-237 Header içermiyor; quoteError yalnız metin olarak gösteriliyor (212-214).

**Etki:** Tarih ya da misafir sayısını değiştirmek veya konaklamaya geri dönmek isteyen misafir yalnız tarayıcının Geri düğmesine güvenebiliyor; PWA ya da derin bağlantıyla gelince Geri de yok. Hata ekranında ne yapacağı söylenmiyor.

**Önerilen aksiyon:** Logo ve '← Konaklamaya dön' (/property/{id}?checkIn&checkOut&guests) içeren minimal bir checkout başlığı eklensin. Konaklama Bilgileri kartına 'Tarihleri/misafirleri değiştir' bağlantısı konsun. quoteError metninin yanına aynı bağlantı bir eylem olarak eklensin ve metin role=alert ile duyurulsun.

## F498 — 'Rezervasyonu Tamamla' rezervasyonu tamamlamıyor: adım göstergesi, tutma ve iptal koşulları önceden söylenmiyor

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | Medium                                                                              |
| Durum               | Gözlemlendi                                                                         |
| Konum               | `src/app/checkout/page.tsx:230`                                                     |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx`                                                     |
| Kullanıcılar        | misafir                                                                             |
| Prensip             | learnability · Predictability ve synthesizability: eylemin sonucu önceden bilinmeli |
| Sezgisel madde      | H13 — Feedforward                                                                   |
| Renk/tema           | Hayır                                                                               |
| Efor                | M                                                                                   |
| Kaynak denetçiler   | runtime:checkout                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                        |

**Kanıt:** RUNTIME: checkout'ta h1 ve düğme aynı metne sahip ('Rezervasyonu Tamamla'). Tıklama yalnızca 15 dk'lık bir HELD kaydı oluşturuyor ve ödeme adımına götürüyor (p2: h1 'Oda sizin için tutuluyor — ödemeyi tamamlayın'). Checkout gövde metninde (tarama bodyTextSample 010/088) ve ödeme sayfası MAIN metninde (p4) adım göstergesi, 'sonraki adımda ödeme' ifadesi ya da iptal politikası yok. Mülkün ücretsiz iptal politikası var (RNPL zaman çizelgesinde 'X tarihine kadar ücretsiz iptal' görünüyor, p10) ama 'Şimdi öde' seçen kullanıcıya hiçbir yerde gösterilmiyor.

**Etki:** Misafir rezervasyonun bittiğini sanıp sayfadan ayrılabilir ve tutma süresi dolar. Karar için kritik olan iptal koşulu ödeme yapılmadan görülemiyor.

**Önerilen aksiyon:** Düğme metni 'Devam et: Ödeme' ya da 'Odayı ayırt ve ödemeye geç' olsun, altına 'Oda 15 dakika sizin için tutulur; ödeme sonraki adımda' notu eklensin. Her iki sayfaya '1 Bilgiler · 2 Ödeme' adım göstergesi konsun. Toplamın yanında iptal koşulu gösterilsin ('{tarih} tarihine kadar ücretsiz iptal' ya da 'İade edilemez').

## F499 — Biçimi hatalı son kullanma tarihi 'Kartın son kullanma tarihi geçmiş' olarak raporlanıyor

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | Medium                                                             |
| Durum               | Gözlemlendi                                                        |
| Konum               | `src/components/booking/BookingActions.tsx:153`                    |
| Diğer konumlar      | `src/lib/payment/card-token.ts`                                    |
| Kullanıcılar        | misafir                                                            |
| Prensip             | learnability · Predictability: hata mesajı gerçek nedeni söylemeli |
| Sezgisel madde      | H9 — Hata mesajları                                                |
| Renk/tema           | Hayır                                                              |
| Efor                | S                                                                  |
| Kaynak denetçiler   | runtime:checkout                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                       |

**Kanıt:** RUNTIME p5-form-validation.mjs: son kullanma alanına '1230' (eğik çizgisiz) girildi, gelen alert 'Kartın son kullanma tarihi geçmiş' oldu. Gerçek neden biçim hatası, 2030 geçmiş bir tarih değil. KOD: card.exp.split('/') '1230' için mm=1230, yy=NaN üretiyor (BookingActions.tsx:153). card-token.ts:60-61 ay ya da yıl geçersiz olduğunda da 'geçmiş' mesajını veriyor.

**Etki:** Kullanıcı kartının süresi dolmuş sanıp başka kart arıyor ya da ödemeden vazgeçiyor; asıl yapması gereken '/' eklemek.

**Önerilen aksiyon:** Biçim ve süre ayrı doğrulansın: /^(0[1-9]|1[0-2])\/?(\d{2})$/ ile eşleşmezse 'Son kullanma tarihini AA/YY biçiminde girin (ör. 08/29)' gösterilsin, yalnız geçmiş tarih için 'süresi geçmiş' kullanılsın. Eğik çizgisiz '1230' girdisi de kabul edilsin.

## F500 — İptal: onay penceresi iade tutarını söylemiyor; ödenmemiş rezervasyon için 'Politika gereği iade yok' deniyor

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Medium                                                                      |
| Durum               | Gözlemlendi                                                                 |
| Konum               | `src/components/booking/BookingActions.tsx:208`                             |
| Diğer konumlar      | `messages/tr/payment.json`                                                  |
| Kullanıcılar        | misafir                                                                     |
| Prensip             | learnability · Predictability: geri dönüşsüz eylemden önce sonucu bilinmeli |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                 |
| Renk/tema           | Hayır                                                                       |
| Efor                | M                                                                           |
| Kaynak denetçiler   | runtime:checkout                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** RUNTIME p15-pay-dblclick.mjs: CONFIRMED rezervasyonda iptal native window.confirm ile 'Rezervasyonu iptal etmek istediğinize emin misiniz?' soruyor (dismiss edildi); iade tutarı ya da politika yok. p17: kendi oluşturduğum ve hiç ödenmemiş HELD rezervasyon iptal edildiğinde role=status 'İptal edildi. Politika gereği iade yok.' çıktı. KOD: BookingActions.tsx:208 confirm, 216-222 refundMinor>0 değilse noRefund; payment.json:23.

**Etki:** Ödeme yapmamış misafir 'iade yok' sözüyle para kaybettiğini sanıyor. Onaylı rezervasyonu iptal eden misafir ne kadar geri alacağını ancak geri dönüşsüz eylemden sonra öğreniyor. Native Türkçe confirm düğmeleri 'Tamam/İptal' olduğundan 'İptal' sözcüğü belirsizleşiyor.

**Önerilen aksiyon:** HELD için 'Rezervasyon iptal edildi; kartınızdan ödeme alınmadı.' gösterilsin. window.confirm yerine önce iade önizlemesini (GET refund quote) çeken bir diyalog kullanılsın: '₺X iade edilecek (%Y)'. Düğmeler açık etiketli olsun: 'Rezervasyonu iptal et' / 'Vazgeç'.

## F501 — İptal sonrası odak body'ye düşüyor; sonuç yalnızca geçici küçük metinle veriliyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/components/booking/BookingActions.tsx:344` |
| Kullanıcılar        | misafir                                         |
| Prensip             | accessibility · Observability                   |
| Sezgisel madde      | H12 — Feedback                                  |
| WCAG                | 2.4.3 Focus Order (A)                           |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | runtime:trips                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** p-cancel-accept.mts (390x844, sahte id): onay kabul -> iptal düğmesi DOM'dan kalkıyor, document.activeElement=body; sonuç role=status 'İptal edildi. Politika gereği iade yok.' text-sm; 'Toplam Tutar ₺7.350,00' değişmeden duruyor, iade satırı yok. Ekran after-cancel-mobile.png.

**Etki:** SR kullanıcısı status'u duysa da bağlamı kaybediyor; tüm kullanıcılar ödenen/iade edilen tutarı tek bakışta göremiyor.

**Önerilen aksiyon:** İptal sonrası odağı tabIndex=-1 olan h1'e veya sonuç kutusuna taşıyın; sunucu verisinden kalıcı 'İade: ₺X (%Y) · durum' satırı gösterin.

## F502 — Kart hataları alanlarla ilişkilendirilmiyor ve iptal düğmesinin altında, alandan uzakta gösteriliyor

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | Medium                                                                              |
| Durum               | Gözlemlendi                                                                         |
| Konum               | `src/components/booking/BookingActions.tsx:363`                                     |
| Kullanıcılar        | misafir                                                                             |
| Prensip             | robustness · Observability: hata kaynağı yerinde ve programatik olarak belirtilmeli |
| Sezgisel madde      | H9 — Hata mesajları                                                                 |
| WCAG                | 3.3.1 Error Identification (A), 1.3.1 Info and Relationships (A)                    |
| Renk/tema           | Hayır                                                                               |
| Efor                | S                                                                                   |
| Kaynak denetçiler   | runtime:checkout                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                        |

**Kanıt:** RUNTIME p5-form-validation.mjs (masaüstü, TR): '1234 5678 9012 3456' girildiğinde role=alert 'Kart numarası geçersiz' çıktı. Hata y=540'ta, 'Rezervasyonu iptal et' düğmesinin altında; kart alanı y=250'de, 'Öde ve onayla' y=418'de. Tüm inputlarda aria-invalid=null, aria-describedby=null. Odak düğmede kaldı. Aynı durum CVC ve süre hatalarında ve red ile HOLD_EXPIRED mesajlarında da görüldü (p6, p11). Ekran görüntüleri: crops/checkout/p5-invalid.png, p11-pay-after-expiry.png. KOD: tek mesaj alanı bileşenin en sonunda, iptal düğmesinden sonra render ediliyor (BookingActions.tsx:344-370).

**Etki:** Hata görsel olarak iptal düğmesine ait görünüyor. Kullanıcı hangi alanı düzeltmesi gerektiğini aramak zorunda kalıyor. Yardımcı teknolojide alan hatalı olarak bildirilmiyor.

**Önerilen aksiyon:** CardValidationError'a alan bilgisi (number|exp|cvc) eklensin. İlgili input'a aria-invalid='true' ve aria-describedby ile bağlı bir hata metni verilsin, metin alanın hemen altında gösterilsin ve odak o alana taşınsın. Sunucu ve genel ödeme hataları ise 'Öde ve onayla' düğmesinin hemen üstünde bir hata özeti olarak gösterilsin.

## F591 — Fiyat bölümünün tamamı aria-live; her kupon değişikliğinde döküm baştan okunuyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                            |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                          |
| Konum               | `src/app/checkout/page.tsx:208`                                                                                                                                                                                                                                                                                                   |
| Diğer konumlar      | `src/components/booking/useQuote.ts:226`, `src/components/booking/CouponField.tsx:334-342`, `src/components/booking/BookingWidget.tsx:232`, `src/components/property/ReviewsSection.tsx:207`, `src/components/plan/TripPlanner.tsx:169`, `src/components/search/SmartFilter.tsx:127`, `src/components/host/HostDashboard.tsx:561` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                           |
| Prensip             | accessibility · Durum mesajları (aşırı duyuru)                                                                                                                                                                                                                                                                                    |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                                                             |
| WCAG                | 4.1.3                                                                                                                                                                                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                             |
| Efor                | S                                                                                                                                                                                                                                                                                                                                 |
| Kaynak denetçiler   | area:checkout, lens:a11y                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                      |

**Kanıt:** checkout/page.tsx:206-209 `<section ... aria-live="polite">` h2'yi, QuoteBreakdown'ı, CouponField girdisini ve düğmelerini ve totalNotice metnini sarıyor. useQuote.ts:226 her yeni istekte `quote: null` atıyor; döküm DOM'dan kalkıp yeniden ekleniyor. Bu yüzden her kupon uygulama ya da kaldırma işleminde gece, vergi ve toplam satırlarının tamamı ile "Kaldır" düğmesi yeniden duyuruluyor.

**Etki:** Ekran okuyucu kullanan misafir kuponun sonucunu (uygulandı / geçersiz) ve yeni toplamı uzun bir okuma içinde kaçırıyor. Bilişsel yük artıyor.

**Önerilen aksiyon:** section'dan aria-live'ı kaldırın. Yalnızca değişen bilgiyi taşıyan tek bir `<p role="status" className="sr-only">` ekleyin: "Kupon uygulandı. Yeni toplam: {total}" ya da kupon durum metni. Bu metin quote değişiminde güncellensin.

## F592 — Rezervasyon ödemesinde 3DS kod alanı görünür etiketsiz ve one-time-code'suz; ödeme düğmesi tutarı göstermiyor

| Alan                | Değer                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                                               |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                             |
| Konum               | `src/components/booking/BookingActions.tsx:327`                                                                                                                                                                                      |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:344-346,387-404`, `src/app/pay/share/[token]/page.tsx:287-289,302-319`, `src/app/checkout/cart/page.tsx:387`, `src/app/pay/share/[token]/page.tsx:302`, `src/components/transfers/ClaimForm.tsx:122` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                              |
| Prensip             | learnability · consistency                                                                                                                                                                                                           |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                          |
| WCAG                | 3.3.2                                                                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                                                                |
| Efor                | S                                                                                                                                                                                                                                    |
| Kaynak denetçiler   | lens:forms, lens:a11y                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                         |

**Kanıt:** src/components/booking/BookingActions.tsx:327-334 `<input inputMode="numeric" aria-label={t("verificationCode")} …/>` — görünür label yok, `autoComplete="one-time-code"` ve maxLength yok; :339 doğrula düğmesi meşgulken metin değiştirmiyor. :318 `t("payAndConfirm")` tutar içermiyor. Aynı akışın sepet/paylaşım sürümleri doğru: src/app/checkout/cart/page.tsx:387-404 (görünür label + one-time-code + processing), :344-346 ve src/app/pay/share/[token]/page.tsx:287-289 (`Öde ve onayla · {tutar}`).

**Etki:** SMS kodunu otomatik dolduramayan mobil misafir kodu elle taşır; tek oda ödemesinde tutar teyidi düğme anında görünmez; ekranlar arası tutarsızlık öğrenmeyi zorlaştırır.

**Önerilen aksiyon:** BookingActions 3DS alanını cart'taki <label> sarmalı + `autoComplete="one-time-code" maxLength={8}` ile değiştir; doğrula düğmesine `busy ? t("processing") : t("verify")`; ödeme düğmesini `${t("payAndConfirm")} · ${f.money(amountMinor - creditMinor, currency)}` yap.

## F746 — Geçersiz URL parametreleri sessiz çıkmaza ve ekranda 'NaN' görünmesine yol açıyor

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Medium                                                                    |
| Durum               | Aday                                                                      |
| Konum               | `src/app/checkout/page.tsx:51`                                            |
| Diğer konumlar      | `src/components/booking/useQuote.ts:200`, `src/app/checkout/page.tsx:201` |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | robustness · recoverability                                               |
| Sezgisel madde      | H5 — Hata önleme                                                          |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | area:checkout                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** checkout/page.tsx:51 `const guestCount = Number(searchParams.get("guestCount") ?? "1");`: "abc" ya da boş değer gelirse NaN üretiyor ve :201'de "NaN" olarak basılıyor. useQuote.ts:200 `checkIn < checkOut ? ... : null` koşulu sağlanmazsa (çıkış ≤ giriş ya da eski yer imi) quote=null, loading=false, error=null dönüyor. Fiyat bölümü boş kalıyor ve düğme kalıcı olarak devre dışı. :148'deki koruma yalnızca parametrenin var olup olmadığına bakıyor.

**Etki:** Eski bir yer imi ya da paylaşılan bağlantıyla gelen misafir boş bir fiyat kutusu ve basılamayan bir düğme görüyor; açıklama yok.

**Önerilen aksiyon:** :148 korumasına şu doğrulamaları ekleyin: ISO tarih regex'i, `checkIn < checkOut`, `checkIn >= bugün`, `Number.isInteger(guestCount) && guestCount >= 1`. Geçersizse eksik-bilgi görünümünde nedeni yazın ("Seçtiğiniz tarihler geçersiz ya da geçmişte kaldı") ve konaklama sayfasına bağlantı verin.

## F747 — Anonim misafir checkout'ta giriş gerektiğini ancak 'Rezervasyonu Tamamla'ya basınca öğreniyor; giriş sayfası nedenini söylemiyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Medium                                                      |
| Durum               | Aday                                                        |
| Konum               | `src/app/checkout/page.tsx:121`                             |
| Diğer konumlar      | `src/app/login/page.tsx:80`, `src/app/checkout/page.tsx:59` |
| Kullanıcılar        | misafir                                                     |
| Prensip             | learnability · predictability                               |
| Sezgisel madde      | H13 — Feedforward                                           |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | lens:nav                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** Checkout mount'ta oturum kontrolü yapmıyor; 121-125'te 401 gelince yönlendiriyor. couponCode (59) URL'de değil, girişten dönünce kayboluyor. login/page.tsx:80-81 başlık ve alt başlık sabit ("Rezervasyonlarınıza ve favorilerinize erişin."); redirect parametresi varken bağlam gösterilmiyor. Oturum açıkken giriş formu yine gösteriliyor.

**Etki:** Kupon girip ödemeye hazırlanan misafir beklenmedik biçimde giriş sayfasına atılıyor ve neden orada olduğunu bilmiyor. Döndüğünde kupon kaybolmuş oluyor.

**Önerilen aksiyon:** Checkout'ta useSession kullanın. Anonimse düğmenin üstünde "Rezervasyonu tamamlamak için giriş yapın veya hesap oluşturun" kutusunu, redirect'i ve kuponu taşıyan loginHref/registerHref ile gösterin. Login sayfasında redirect varsa "Giriş yaptıktan sonra işleminize döneceksiniz" alt başlığını gösterin; oturum açıksa doğrudan redirect'e gidin.

## F748 — JSON olmayan yanıt ya da ağ kopması teknik JS hata metni olarak gösteriliyor

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Medium                              |
| Durum               | Aday                                |
| Konum               | `src/app/checkout/page.tsx:127`     |
| Diğer konumlar      | `src/app/checkout/page.tsx:142-144` |
| Kullanıcılar        | misafir                             |
| Prensip             | robustness · recoverability         |
| Sezgisel madde      | H9 — Hata mesajları                 |
| Renk/tema           | Hayır                               |
| Efor                | S                                   |
| Kaynak denetçiler   | area:checkout                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** checkout/page.tsx:127 `const data = await res.json();` res.ok kontrolünden önce çalışıyor. Proxy 502 HTML döndürürse SyntaxError atılıyor; çevrimdışıyken fetch TypeError atıyor. :142-143 `setError(err instanceof Error ? err.message : t("createFailed"))` bunları "Unexpected token '<' ..." ya da "Failed to fetch" gibi İngilizce ve teknik metinler olarak kullanıcıya basıyor.

**Etki:** Mobil ve zayıf ağdaki misafir anlamsız bir teknik mesaj görüyor. Yeniden denemenin güvenli olduğunu (idempotency anahtarı aynı kaldığı için) bilmiyor.

**Önerilen aksiyon:** Kendi attığınız hataları ayrı bir sınıfla (ör. `class CheckoutError`) işaretleyin. Diğer tüm hatalarda `t("createFailed")` gösterin. Ağ hatasında "Bağlantı sorunu. Tekrar deneyin; aynı rezervasyon iki kez oluşturulmaz." metni ve "Tekrar dene" düğmesi verin. `res.json()` çağrısını try/catch ile sarın.

## F749 — Fiyat değişince ya da kupon uygulanınca eski ve yeni tutar karşılaştırılamıyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Medium                                                                         |
| Durum               | Aday                                                                           |
| Konum               | `src/app/checkout/page.tsx:133`                                                |
| Diğer konumlar      | `src/components/booking/useQuote.ts:226`, `src/lib/booking-service.ts:527-531` |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | robustness · observability                                                     |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                        |
| Renk/tema           | Hayır                                                                          |
| Efor                | M                                                                              |
| Kaynak denetçiler   | area:checkout                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                   |

**Kanıt:** checkout/page.tsx:133-135 PRICE_CHANGED durumunda yalnızca `t("priceChanged")` gösteriliyor: "Fiyat değişti. Güncel fiyatı kontrol edip tekrar onaylayın." Oysa sunucu booking-service.ts:527-531'de `details: { previousTotal, currentTotal, currency }` gönderiyor. Ayrıca useQuote.ts:226 yeni istekte eski teklifi sildiği için önceki toplam ekrandan kalkıyor; kupon öncesi ve sonrası tutarları kullanıcı aklında tutmak zorunda kalıyor.

**Etki:** Para hatasına toleransı düşük misafir fiyatın ne kadar arttığını hatırlamak zorunda kalıyor; tanıma yerine hatırlamaya dayanıyor. Fark büyükse fark etmeden onaylayabiliyor.

**Önerilen aksiyon:** PRICE_CHANGED hatasında details'ı okuyup şunu gösterin: "Toplam {f.money(previousTotal)} → {f.money(currentTotal)} olarak güncellendi". useQuote'ta yeni istek sırasında önceki teklifi `stale` olarak tutup "güncelleniyor…" etiketiyle gösterin. Kupon uygulanınca "İndirim: −{amount}" satırını vurgulayın.

## F750 — Konaklama yükleme hatası 'bilgiler eksik' başlığıyla gösteriliyor; yeniden deneme yok

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Medium                          |
| Durum               | Aday                            |
| Konum               | `src/app/checkout/page.tsx:148` |
| Diğer konumlar      | `messages/tr/checkout.json:7`   |
| Kullanıcılar        | misafir                         |
| Prensip             | robustness · recoverability     |
| Sezgisel madde      | H9 — Hata mesajları             |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:checkout                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**    |

**Kanıt:** checkout/page.tsx:87-89 `.catch(() => { if (active) setLoadError(t("loadFailed")); })` → :148 `if (!propertyId || ... || loadError)`. Ağ hatası olduğunda ekranda h1 :155 `t("missingTitle")` "Rezervasyon bilgileri eksik", altında "Konaklama bilgileri alınamadı." ve tek bağlantı "Ana sayfaya dön" (:157-159) çıkıyor. Hata kutusu role="alert" taşımıyor ve yeniden deneme düğmesi yok.

**Etki:** Yavaş ya da kopuk mobil ağda geçici bir hata misafirin bütün seçimini (oda, tarih, kupon) silip ana sayfaya göndermesine yol açıyor. Başlık sorunun nedenini yanlış anlatıyor.

**Önerilen aksiyon:** loadError için ayrı bir dal kurun: h1 "Konaklama bilgileri yüklenemedi", kapsayıcıda `role="alert"`, "Tekrar dene" düğmesi (bir `retry` sayacını artırıp useEffect bağımlılığına ekleyerek) ve "Konaklama sayfasına dön" bağlantısı (/property/{propertyId}). Eksik parametre durumunda "Ana sayfaya dön" yerine "Yeniden ara" (/search) gösterin.

## F751 — Rezervasyon akışında adım göstergesi yok (Bilgiler → Ödeme → Onay)

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Medium                              |
| Durum               | Aday                                |
| Konum               | `src/app/checkout/page.tsx:166`     |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:128` |
| Kullanıcılar        | misafir                             |
| Prensip             | robustness · observability          |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü      |
| Renk/tema           | Hayır                               |
| Efor                | M                                   |
| Kaynak denetçiler   | area:checkout                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** checkout/page.tsx:166-167 yalnızca `<main ...><h1>{t("title")}</h1>` çiziyor. Ödeme adımı ayrı bir sayfada (booking/[id]/page.tsx:165 BookingActions). İki sayfada da kullanıcının toplam kaç adımın kaçıncısında olduğunu gösteren bir öğe yok.

**Etki:** Misafir, özellikle düşük bilgisayar okuryazarlığında, sürecin ne kadar süreceğini ve ödemeyi henüz yapmadığını kavrayamıyor. Bu durum bir önceki bulgudaki yanlış anlamayı pekiştiriyor.

**Önerilen aksiyon:** Her iki sayfaya `<ol aria-label="Rezervasyon adımları">` ekleyin: 1. Bilgileri kontrol et, 2. Ödeme, 3. Onay. Geçerli adıma `aria-current="step"` ve görünür "Adım 1/3" metni verin. Adım durumu yalnızca renkle gösterilmesin.

## F752 — Checkout'ta geri dönme, tarih veya misafiri düzenleme yolu yok; tek çıkış tarayıcının geri tuşu

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Aday                                                 |
| Konum               | `src/app/checkout/page.tsx:166`                      |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:99`                   |
| Kullanıcılar        | misafir                                              |
| Prensip             | flexibility · dialog initiative (kullanıcı kontrolü) |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                    |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | area:checkout                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** checkout/page.tsx:165-167 `<main id="main" ...><h1>...` ile başlıyor; Header, logo ya da "Konaklamaya dön" bağlantısı yok (docs/img/checkout-breakdown.png'de de üst gezinme görünmüyor). Ödeme sayfası ise booking/[id]/page.tsx:99'da `<Header />` çiziyor. Tarih (:193-198), misafir (:199-202) ve oda (:185-192) satırlarının yanında "Değiştir" bağlantısı yok. Hata ekranı (:157) yalnızca ana sayfaya dönüyor ve seçimi kaybettiriyor.

**Etki:** Misafir son kontrolde yanlış tarih ya da kişi sayısı fark ederse geri dönmenin yolunu bilmiyor. Mobil PWA kipinde ya da geri tuşu olmayan görünümde akışta sıkışıyor.

**Önerilen aksiyon:** h1'in üstüne `<Link href={`/property/${propertyId}?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guestCount}`}>← Konaklamaya dön</Link>` ekleyin. Tarih, misafir ve oda satırlarına aynı hedefe giden "Değiştir" bağlantısı koyun; bağlantı metni sr-only olarak "tarihleri" gibi bağlam taşısın. İsteğe bağlı olarak logolu yalın bir başlık kullanın.

## F753 — Sepet, ödeme ve pay ödeme sayfalarında site başlığı/gezinme yok; tek oda checkout'ta 'değiştir/geri' yolu yok

| Alan                | Değer                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                      |
| Durum               | Aday                                                                                                                                        |
| Konum               | `src/app/checkout/page.tsx:166`                                                                                                             |
| Diğer konumlar      | `src/app/cart/page.tsx:63`, `src/app/checkout/cart/page.tsx:232`, `src/app/pay/share/[token]/page.tsx:178`, `src/app/checkout/page.tsx:196` |
| Kullanıcılar        | misafir                                                                                                                                     |
| Prensip             | robustness · recoverability                                                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                       |
| Efor                | S                                                                                                                                           |
| Kaynak denetçiler   | lens:status                                                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                |

**Kanıt:** Header/PageShell içermeyen sayfalar: cart/page.tsx:63, checkout/page.tsx:166, checkout/cart/page.tsx:232, pay/share/[token]/page.tsx:178 (yalnız `<main id="main">`). checkout/page.tsx:170-204 özetinde tarih/oda/misafir için 'Değiştir' bağlantısı yok; 196 tarihler ham ISO `{checkIn} → {checkOut}`.

**Etki:** Misafir seçimini düzeltmek için tarayıcı geri tuşuna mecbur; dil değiştiremiyor, hesabına/sepetine gidemiyor; diğer sayfalarla tutarsız.

**Önerilen aksiyon:** Bu sayfaları PageShell ya da sadeleştirilmiş checkout başlığıyla (logo + dil seçici + 'Güvenli ödeme') sar; checkout özetine 'Tarihleri/odayı değiştir' bağlantısı (/property/{id}?checkIn&checkOut&guests&roomId) ve tarihleri `f.date(..., 'long')` ile biçimlendir.

## F754 — Sepet, ödeme ve pay ödeme sayfalarında genel başlık/dil seçici/geri dönüş yok

| Alan                | Değer                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                     |
| Durum               | Aday                                                                                                       |
| Konum               | `src/app/checkout/page.tsx:166`                                                                            |
| Diğer konumlar      | `src/app/cart/page.tsx:63`, `src/app/checkout/cart/page.tsx:232`, `src/app/pay/share/[token]/page.tsx:178` |
| Kullanıcılar        | misafir                                                                                                    |
| Prensip             | learnability · consistency                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                          |
| Renk/tema           | Hayır                                                                                                      |
| Efor                | S                                                                                                          |
| Kaynak denetçiler   | lens:copy                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                               |

**Kanıt:** checkout/page.tsx:166, cart/page.tsx:63, checkout/cart/page.tsx:232, pay/share/[token]/page.tsx:178 yalnız `<main>` döndürür; Header/Footer/PageShell yok (src/app altında ek layout da yok). Oysa 'Sepetim' Header.tsx:24 menüsünde; booking/[id] ve account Header içerir. Checkout'ta ilan sayfasına geri dönüş bağlantısı da yok.

**Etki:** Menüden 'Sepetim'e giden kullanıcı menüyü kaybeder; ödeme sırasında dil değiştiremez, tarayıcı geri tuşu dışında çıkış yolu yoktur.

**Önerilen aksiyon:** Bu sayfaları PageShell ile sarın veya en azından logo + dil seçici + 'İlana dön' bağlantısı içeren sade bir ödeme başlığı ekleyin.

## F755 — Konaklama tarihleri ekranlara göre beş farklı biçimde yazılıyor (ham ISO dahil) ve tarih aralığı ayırıcısı değişiyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Konum               | `src/app/checkout/page.tsx:196`                                                                                                                                                                                                                                                                                                                                                                                           |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:129-132`, `src/app/cart/page.tsx:129-130`, `src/app/booking/[id]/page.tsx:93`, `src/app/account/page.tsx:156`, `src/app/search/page.tsx:289`, `src/app/compare/page.tsx:99-100`, `src/components/plan/TripPlanner.tsx:187`, `src/components/host/PartyRiskPanel.tsx:63`, `src/components/compliance/ComplianceDashboard.tsx:137`, `src/components/search/SmartFilter.tsx:52-60` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                                                                                                                                                                                                                                 |
| Prensip             | learnability · consistency                                                                                                                                                                                                                                                                                                                                                                                                |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                              |

**Kanıt:** checkout/page.tsx:196 `{checkIn} → {checkOut}` ham ISO ("2026-10-12 → 2026-10-15"). Aynı akışın diğer adımlarında farklı biçimler var: BookingWidget.tsx:130 `f.date(s, "medium")` ve " - ", cart/page.tsx:129-130 medium ve "→", booking/[id]/page.tsx:93 ile account/page.tsx:156 ve TripsView.tsx:145 "long", search/page.tsx:289 ve compare/page.tsx:99 ile TripPlanner.tsx:187 varsayılan "short" ("12.10.2026") ve "-" ya da "–". Ham ISO gösterilen başka yerler: PartyRiskPanel.tsx:63, ComplianceDashboard.tsx:137 `td.slaDueAt.slice(0, 16).replace("T", " ")` (UTC), SmartFilter.tsx:60 çip etiketi `value: f.checkIn`. docs/img/v4-compare.png "24.06.2027 – 26.06.2027" gösterirken v4-cart.png "24 Haz 2027 → 26 Haz 2027" gösteriyor.

**Etki:** Misafir aynı konaklamanın tarihini dört adımda dört farklı görünümde okur. Ödemeden hemen önceki özet ekranında ISO biçimi en zor okunanıdır ve tarih hatasına toleransın en düşük olduğu yer burasıdır. Admin SLA saatini UTC olarak yerel saat sanabilir.

**Önerilen aksiyon:** Formatter'a `stay(checkIn, checkOut)` metodu ekleyin. "medium" stil ve tek ayırıcı (" – ") kullansın, gece sayısını da isteğe bağlı eklesin. Tüm konaklama aralığı gösterimlerinde bunu kullanın. checkout/page.tsx:196, PartyRiskPanel.tsx:63 ve SmartFilter çiplerinde `f.date` çağırın, ComplianceDashboard'da `f.dateTime(td.slaDueAt)` kullanın. Ayırıcı için booking.widget.dates ile checkout.dates'teki tire ve uzun çizgi farkını da giderin.

## F756 — Özet ekranlarında ham ISO tarih ve '→' oku; SLA saati yerelleştirilmemiş UTC

| Alan                | Değer                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                               |
| Durum               | Aday                                                                                                 |
| Konum               | `src/app/checkout/page.tsx:196`                                                                      |
| Diğer konumlar      | `src/components/host/PartyRiskPanel.tsx:63`, `src/components/compliance/ComplianceDashboard.tsx:137` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                            |
| Prensip             | learnability · familiarity                                                                           |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                          |
| Renk/tema           | Hayır                                                                                                |
| Efor                | S                                                                                                    |
| Kaynak denetçiler   | lens:a11y                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                         |

**Kanıt:** checkout/page.tsx:193-198 `<dd ...>{checkIn} → {checkOut}</dd>` ('2026-11-12 → 2026-11-15'); PartyRiskPanel.tsx:62-64 `{i.checkIn} → {i.checkOut}`; ComplianceDashboard.tsx:137 `t("slaDue", { at: td.slaDueAt.slice(0, 16).replace("T", " ") })` — UTC saat dilimi belirtilmeden yerel saat gibi gösteriliyor. Diğer ekranlar `f.date(..., "long")` kullanıyor (booking/[id]/page.tsx:93).

**Etki:** Misafir ödeme özetinde (en düşük tarih hatası toleransı) tarihleri makine biçiminde görüyor, ekran okuyucu '2026 tire 11 tire 12 sağ ok …' okuyor; yönetici yasal SLA son saatini 3 saat sapmalı yorumlayabilir.

**Önerilen aksiyon:** `f.date(checkIn, "long")` ile haftanın günü dahil biçimlendirin ve 'Giriş: … / Çıkış: …' olarak ayrı dt/dd satırları kullanın; '→' yerine metin ('ile') veya `aria-hidden` ok + sr-only metin; SLA için `f.dateTime(td.slaDueAt)` + saat dilimi.

## F757 — Ödeme öncesi son kontrol ekranında ve ev sahibi listesinde ham ISO tarih

| Alan                | Değer                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                  |
| Durum               | Aday                                                                                    |
| Konum               | `src/app/checkout/page.tsx:196`                                                         |
| Diğer konumlar      | `src/components/host/PartyRiskPanel.tsx:63`, `src/components/search/SmartFilter.tsx:60` |
| Kullanıcılar        | misafir, ev sahibi                                                                      |
| Prensip             | learnability · familiarity                                                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                             |
| Renk/tema           | Hayır                                                                                   |
| Efor                | S                                                                                       |
| Kaynak denetçiler   | lens:mobile                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                            |

**Kanıt:** checkout/page.tsx:196 `{checkIn} → {checkOut}` ekranda '2026-10-12 → 2026-10-15' olarak görünüyor; gün adı ve gece sayısı yok. PartyRiskPanel.tsx:63 `{i.checkIn} → {i.checkOut}` aynı biçimi kullanıyor. SmartFilter.tsx:60/62 çip etiketleri `value: f.checkIn` ile ham değeri gösteriyor. Diğer ekranlar f.date kullanıyor (cart/page.tsx:129, booking/[id]/page.tsx:93).

**Etki:** Misafir rezervasyonu onaylamadan önceki son ekranda tarihi YYYY-AA-GG biçiminde görüyor. Gün ile ayı karıştırabilir, hafta gününü kontrol edemez. Bu, tarih hatasına toleransın en düşük olduğu adım.

**Önerilen aksiyon:** Tarihi `f.date(checkIn, "long")` ve hafta günüyle göster (örn. 'Pzt 12 Eki 2026 → Per 15 Eki 2026 · 3 gece'). PartyRiskPanel ve SmartFilter çiplerinde `f.date(…, "medium")` kullan.

## F758 — Fiyat alınamadığında ya da oda dolduğunda çıkmaz; düğme nedeni açıklanmadan devre dışı

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Aday                                                                          |
| Konum               | `src/app/checkout/page.tsx:213`                                               |
| Diğer konumlar      | `src/app/checkout/page.tsx:232`, `src/components/booking/useQuote.ts:236-237` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | robustness · recoverability                                                   |
| Sezgisel madde      | H9 — Hata mesajları                                                           |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | area:checkout                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** checkout/page.tsx:213 `{quoteError && <p className="text-sm text-red-600">{quoteError}</p>}` yanında yeniden deneme ya da alternatif yok. :232 `disabled={submitting || !quote || !idempotencyKey}` için görünür veya aria-describedby ile bağlı bir neden metni yok. useQuote.ts:236-237 hata `code` değerini (ör. SOLD_OUT) döndürüyor ama checkout :64-77 `code` alanını hiç almıyor.

**Etki:** Misafir gri düğmeye neden basamadığını anlamıyor. Oda dolduysa başka tarih seçmek için yol gösterilmiyor ve misafir akışı terk ediyor.

**Önerilen aksiyon:** quoteError olduğunda "Tekrar dene" düğmesi ekleyin (`setRefreshKey(k => k + 1)`). `code === "SOLD_OUT"` için "Bu oda seçtiğiniz tarihlerde dolu" metni ile "Başka tarih seç" bağlantısı (/property/{id}) gösterin. Gönder düğmesine `aria-describedby` ile bağlı kısa bir neden metni ekleyin ("Fiyat hesaplanıyor…" / "Fiyat alınamadı").

## F759 — Ödeme yapılandırması gelmeden mock form çiziliyor; hata olursa yanlış forma düşülüyor ve seçenekler sonradan form üstüne ekleniyor

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                 |
| Durum               | Aday                                                                                                   |
| Konum               | `src/components/booking/BookingActions.tsx:47`                                                         |
| Diğer konumlar      | `src/components/booking/RnplOption.tsx:32-40`, `src/components/booking/WalletCreditOption.tsx:139-153` |
| Kullanıcılar        | misafir                                                                                                |
| Prensip             | robustness · responsiveness                                                                            |
| Sezgisel madde      | H15 — Performans                                                                                       |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | M                                                                                                      |
| Kaynak denetçiler   | area:checkout                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                           |

**Kanıt:** BookingActions.tsx:47-50 `useState<PaymentConfig>({ provider: "mock", publishableKey: null })` ile başlıyor; yapılandırma :68-73'te sonradan geliyor ve `.catch(() => undefined); // Yapılandırma okunamazsa mock form kalır.` Stripe ortamında ilk karede mock kart formu çiziliyor, ardından Stripe formuyla değiştiriliyor. Okuma hata verirse mock token Stripe'a gidiyor ve errors.ts:173-177 "Kart bilgisi geçersiz" dönüyor. RnplOption.tsx:32-40 ve WalletCreditOption.tsx:139-151 de asenkron yüklenip kart formunun üstüne yer tutucusuz ekleniyor.

**Etki:** Hızlı yazan misafirin mock forma girdiği kart bilgisi form değişince kayboluyor. Yazarken form aşağı kayıyor. Yapılandırma hatasında kart geçerli olduğu hâlde "geçersiz" mesajı alınıyor.

**Önerilen aksiyon:** payConfig başlangıcını `null` yapın ve çözülene kadar `<p role="status">Ödeme seçenekleri yükleniyor…</p>` ile sabit yükseklikte bir iskelet gösterin. Okuma hatasında demo modu değilse mock'a düşmeyin; "Ödeme formu yüklenemedi" ve "Tekrar dene" gösterin. RNPL ve kredi blokları için min-height ayırın ya da hepsi yüklenene kadar formu göstermeyin.

## F760 — Step-up açıklaması 'ödeme otomatik yeniden denenir' diyor; Stripe akışında kullanıcı yeniden göndermek zorunda

| Alan                | Değer                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                        |
| Durum               | Aday                                                                                                          |
| Konum               | `src/components/booking/BookingActions.tsx:128`                                                               |
| Diğer konumlar      | `messages/tr/payment.json:30`, `messages/en/payment.json:30`, `src/components/booking/StepUpDialog.tsx:61-63` |
| Kullanıcılar        | misafir                                                                                                       |
| Prensip             | learnability · predictability (feedforward doğruluğu)                                                         |
| Sezgisel madde      | H13 — Feedforward                                                                                             |
| Renk/tema           | Hayır                                                                                                         |
| Efor                | S                                                                                                             |
| Kaynak denetçiler   | area:checkout                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                  |

**Kanıt:** payment.json:30 stepUp.description: "Onaydan sonra ödeme otomatik olarak yeniden denenir." Stripe akışında BookingActions.tsx:128 `if (isStepUp(err)) setStepUp({ cardToken: "" });` → :101-104 `if (!pending?.cardToken) { setStepUpToken(token); setMessage({ kind: "info", text: t("verifiedRetry") }); return; }`. Ödeme otomatik tekrarlanmıyor; kullanıcının "Öde ve onayla" düğmesine yeniden basması gerekiyor ("Doğrulandı. Ödemeyi yeniden gönderebilirsiniz.").

**Etki:** Misafir ödemenin kendiliğinden tamamlanacağını bekleyip sayfada bekliyor ya da sayfadan ayrılıyor. 15 dakikalık tutma süresi dolabiliyor.

**Önerilen aksiyon:** StepUpDialog'a `autoRetry: boolean` prop'u ekleyin. Stripe yolunda `description` yerine yeni `stepUp.descriptionManual` gösterilsin: "Onayladıktan sonra 'Öde ve onayla' düğmesine yeniden basın." Daha iyisi, doğrulamadan sonra StripePaymentForm'daki form ref'ine `requestSubmit()` çağrılarak gerçekten otomatik yeniden gönderim yapılsın.

## F761 — Ödeme deneme sınırı (5) görünmüyor; sınır aşılınca form etkin kalıyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/booking/BookingActions.tsx:178` |
| Diğer konumlar      | `src/lib/payment/pay.ts:45-53`                  |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · predictability                   |
| Sezgisel madde      | H13 — Feedforward                               |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:checkout                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** pay.ts:45-53 `PaymentAttemptsExceededError` → "Çok fazla başarısız ödeme denemesi. Bu rezervasyon için ödeme kapatıldı." (app-config.ts:532 PAYMENT_MAX_ATTEMPTS=5, 24 saatlik pencere). BookingActions.tsx:178-181 yalnızca ham mesajı basıyor. Durum hâlâ HELD olduğu için :265'teki kart formu gösterilmeye devam ediyor. Ret sonrasında kalan deneme hakkı yazılmıyor.

**Etki:** Misafir kalan hakkını bilmeden kart denemeye devam ediyor. Kilitlendikten sonra form hâlâ etkin görünüyor ve ne yapacağı (iptal, destek) belirsiz kalıyor.

**Önerilen aksiyon:** Sunucu PAYMENT_DECLINED yanıtının details alanına `attemptsLeft` eklesin ve UI "Kalan deneme hakkı: {n}" göstersin. PAYMENT_ATTEMPTS_EXCEEDED geldiğinde kart formunu gizleyip açıklama, "Destekle iletişime geç" (/support?bookingId=…) ve "Rezervasyonu iptal et" seçeneklerini gösterin.

## F762 — Ödenmemiş (HELD) rezervasyon iptalinde yanıltıcı 'Politika gereği iade yok' mesajı

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/booking/BookingActions.tsx:217`              |
| Diğer konumlar      | `messages/tr/payment.json:23`, `messages/en/payment.json:23` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · predictability                                |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                  |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:checkout                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** BookingActions.tsx:217-222 `res.refund.refundMinor > 0 ? t("cancel.refunded", ...) : t("cancel.noRefund")`. İptal düğmesi HELD durumunda da görünüyor (:344 `status === "HELD" || status === "CONFIRMED"`). HELD rezervasyonda hiç tahsilat yapılmadığı için refundMinor=0 dönüyor ve payment.json:23 "İptal edildi. Politika gereği iade yok." gösteriliyor. RNPL planında tahsilattan önce yapılan iptal de bu dala düşüyor.

**Etki:** Ödeme yapmamış misafir parasının yandığını sanıyor ve gereksiz destek talebi açıyor ya da kaygılanıyor. Sistem durumu gerçek dünyayla örtüşmüyor.

**Önerilen aksiyon:** Durum HELD ise (ya da RNPL planında tahsilat yapılmamışsa) yeni `cancel.holdReleased` anahtarını kullanın: "Rezervasyon iptal edildi. Sizden herhangi bir ödeme alınmadı." `noRefund` yalnızca ödenmiş ve iadesiz durumda kalsın.

## F763 — Kart alanlarında biçim kısıtı ve maskesi yok; '1230' girilince 'süresi geçmiş' hatası çıkıyor

| Alan                | Değer                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                             |
| Durum               | Aday                                                                                                                                                                                               |
| Konum               | `src/components/booking/BookingActions.tsx:287`                                                                                                                                                    |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:153`, `src/lib/payment/card-token.ts:157-159`, `src/components/booking/BookingActions.tsx:275-282`, `src/components/booking/BookingActions.tsx:298-304` |
| Kullanıcılar        | misafir                                                                                                                                                                                            |
| Prensip             | flexibility · substitutivity                                                                                                                                                                       |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                   |
| WCAG                | 3.3.3                                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                                              |
| Efor                | S                                                                                                                                                                                                  |
| Kaynak denetçiler   | area:checkout                                                                                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                       |

**Kanıt:** Son kullanma girdisinde (:287-292) inputMode="numeric", maxLength ve placeholder yok. :153 `card.exp.split("/").map(...)` "1230" için yy=undefined → NaN üretiyor ve card-token.ts:158-159 `throw new CardValidationError("Kartın son kullanma tarihi geçmiş")` yanlış nedeni bildiriyor. Kart numarasında (:275-282) maxLength ve 4'lü gruplama yok. CVC'de (:298-304) maxLength=4 yok ve kodun nerede olduğuna dair ipucu yok.

**Etki:** Mobil misafir son kullanma alanında harf klavyesiyle karşılaşıyor. Eğik çizgisiz giriş yanlış "süresi geçmiş" mesajı üretiyor ve kullanıcı kartının geçerliliğinden şüpheleniyor.

**Önerilen aksiyon:** Son kullanma: `inputMode="numeric" placeholder="AA/YY" maxLength={5}`; iki rakamdan sonra "/" otomatik eklensin ve "1230" ile "12/30" aynı kabul edilsin. Biçim hatası için ayrı bir metin ekleyin: "Son kullanma tarihini AA/YY biçiminde girin". Kart numarası: `maxLength={23}`, yazarken 4'lü gruplama. CVC: `maxLength={4}` ve "Kartın arkasındaki 3 haneli kod" ipucu (aria-describedby ile bağlı).

## F764 — Ödeme düğmeleri tahsil edilecek tutarı göstermiyor

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Aday                                                                             |
| Konum               | `src/components/booking/BookingActions.tsx:318`                                  |
| Diğer konumlar      | `src/components/booking/StripePaymentForm.tsx:84`, `messages/tr/payment.json:16` |
| Kullanıcılar        | misafir                                                                          |
| Prensip             | learnability · predictability (feedforward)                                      |
| Sezgisel madde      | H13 — Feedforward                                                                |
| Renk/tema           | Hayır                                                                            |
| Efor                | S                                                                                |
| Kaynak denetçiler   | area:checkout                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                     |

**Kanıt:** BookingActions.tsx:318 `t("payAndConfirm")` → "Öde ve onayla". StripePaymentForm.tsx:84 aynı metni kullanıyor. Kartla ödenecek tutar cüzdan kredisi kullanılınca toplamdan farklılaşıyor (:255 `amountMinor! - creditMinor`). Toplam ise booking/[id]/page.tsx:156-161'de, seçeneklerin ve formun çok üstünde kalıyor.

**Etki:** Misafir düğmeye basarken kartından tam olarak ne kadar çekileceğini görmüyor; özellikle kredi ya da RNPL seçildiğinde emin olamıyor.

**Önerilen aksiyon:** Yeni anahtar `payment.payAmount: "{amount} öde ve onayla"` ekleyin ve `f.money(amountMinor - creditMinor, currency)` ile doldurun. Stripe düğmesinde de aynısını kullanın. RNPL için mevcut `rnpl.reserve` metni kalsın.

## F765 — Tek oda ödeme düğmesi tutarı göstermiyor (sepet ve pay ödemesi gösteriyor)

| Alan                | Değer                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                            |
| Durum               | Aday                                                                                                                              |
| Konum               | `src/components/booking/BookingActions.tsx:318`                                                                                   |
| Diğer konumlar      | `src/components/booking/StripePaymentForm.tsx:84`, `src/app/checkout/cart/page.tsx:346`, `src/app/pay/share/[token]/page.tsx:289` |
| Kullanıcılar        | misafir                                                                                                                           |
| Prensip             | learnability · predictability (feedforward)                                                                                       |
| Sezgisel madde      | H13 — Feedforward                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                             |
| Efor                | S                                                                                                                                 |
| Kaynak denetçiler   | lens:copy                                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                      |

**Kanıt:** BookingActions.tsx:318 `rnpl ? t("rnpl.reserve") : t("payAndConfirm")` → 'Öde ve onayla'; StripePaymentForm.tsx:84 aynı. Buna karşın checkout/cart/page.tsx:346 `${tp("payAndConfirm")} · ${f.money(cart.totalMinor, ...)}` ve pay/share/[token]/page.tsx:289 tutarı düğmeye yazıyor. Cüzdan kredisi seçildiğinde kartla ödenecek kalan yalnız WalletCreditOption içinde (281-285).

**Etki:** Misafir kredi düşüldükten sonra karttan çekilecek tutarı düğmede görmeden onaylar; üç ödeme ekranı arasında tutarsızlık.

**Önerilen aksiyon:** Düğmeyi `${t("payAndConfirm")} · ${f.money(amountMinor - creditMinor, currency)}` yapın (RNPL'de 'Bugün ödeme yok — {tarih}'te ₺X'); aynısını StripePaymentForm'a amountMinor prop'u ile uygulayın.

## F766 — 3DS adımında geri dönme ya da başka kart kullanma yolu yok; doğrula düğmesi meşgul durumunu göstermiyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Aday                                                |
| Konum               | `src/components/booking/BookingActions.tsx:323`     |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:187-205` |
| Kullanıcılar        | misafir                                             |
| Prensip             | robustness · recoverability                         |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                   |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | area:checkout                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** BookingActions.tsx:323 `{challenge && (`: challenge yalnızca başarıda temizleniyor (:195 `setChallenge(null)`). Formda "Vazgeç" ya da "Başka kart kullan" düğmesi yok. :339 `{t("verify")}` metni busy iken de değişmiyor (yalnızca :336 `disabled={busy}`). Yanlış koddan sonra girdi temizlenmiyor ve odaklanmıyor.

**Etki:** Bankasından kod gelmeyen ya da başka kartla ödemek isteyen misafir 3DS ekranında sıkışıyor; tek çıkış sayfayı yenilemek ya da rezervasyonu iptal etmek.

**Önerilen aksiyon:** Forma ikincil bir `<button type="button">` ekleyin: "Geri dön / başka kart kullan" → `setChallenge(null); setCode("");` ve ardından odağı kart numarası alanına taşıyın. Düğme metnini `{busy ? t("processing") : t("verify")}` yapın. Hatada `setCode("")` ile girdiyi temizleyip odaklayın.

## F767 — 3D Secure doğrulama formlarında 'Vazgeç / başka kart dene' yolu yok

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Medium                                                                         |
| Durum               | Aday                                                                           |
| Konum               | `src/components/booking/BookingActions.tsx:323`                                |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:379`, `src/app/pay/share/[token]/page.tsx:294` |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | robustness · recoverability                                                    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                              |
| Renk/tema           | Hayır                                                                          |
| Efor                | S                                                                              |
| Kaynak denetçiler   | lens:status                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                   |

**Kanıt:** BookingActions.tsx:323-342 challenge formunda yalnız kod alanı + 'Doğrula'; challenge state'ini temizleyen kontrol yok. checkout/cart/page.tsx:379-405 ve pay/share/[token]/page.tsx:294-321 aynı.

**Etki:** SMS kodu gelmeyen misafir başka kartla deneyemiyor; tutma süresi işlerken sayfayı yenilemek zorunda kalıyor.

**Önerilen aksiyon:** Her challenge formuna ikincil 'Vazgeç, başka kartla öde' butonu: setChallenge(null), setCode(''), sepette setPayKey(newKey()); 'Kod gelmedi mi?' yardım metni; odak kart numarası alanına.

## F768 — Dört ayrı kart formu tutarsız: OTP otomatik doldurma eksik, son kullanma tarihi önceden dolu

| Alan                | Değer                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                     |
| Durum               | Aday                                                                                                                                                                                                                                                       |
| Konum               | `src/components/booking/BookingActions.tsx:327`                                                                                                                                                                                                            |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:392`, `src/app/pay/share/[token]/page.tsx:307`, `src/components/booking/BookingActions.tsx:51`, `src/app/checkout/cart/page.tsx:36`, `src/app/pay/share/[token]/page.tsx:33`, `src/components/transfers/ClaimForm.tsx:123` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                    |
| Prensip             | learnability · consistency                                                                                                                                                                                                                                 |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                      |
| Efor                | M                                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                               |

**Kanıt:** 3DS kodu: BookingActions.tsx:327-333 `inputMode="numeric" aria-label={t("verificationCode")}` içinde `autoComplete="one-time-code"` yok; checkout/cart/page.tsx:392 ve pay/share/[token]/page.tsx:307'de var. Son kullanma tarihi BookingActions.tsx:51, checkout/cart/page.tsx:36 ve pay/share/[token]/page.tsx:33'te `exp: "12/30"` ile önceden dolu. Bu alanlarda (BookingActions.tsx:287-292 vb.) `inputMode`, `placeholder="AA/YY"` ve `maxLength` yok, metin klavyesi açılıyor. ClaimForm.tsx:123-146 ise ayrı `type="number"` ay ve yıl alanları kullanıyor. Kart numarasında hiçbir formda gruplama ya da `maxLength` yok (BookingActions.tsx:275-282).

**Etki:** Tek oda ödemesinde SMS doğrulama kodu klavye önerisinden otomatik dolmuyor (sepet ödemesinde doluyor), mobilde uygulamalar arası geçiş ve hata gerekiyor. Önceden dolu '12/30' kontrol edilmeden gönderilebiliyor (gerçek sağlayıcıda red). Devir pazarında farklı tarih alanı düzeni öğrenmeyi bozuyor.

**Önerilen aksiyon:** Ortak `<CardFields>` ve `<OtpField>` bileşenlerini çıkar ve dört formda kullan. Numara: `inputMode=numeric autoComplete=cc-number maxLength=23`, dörtlü gruplara otomatik boşluk. Son kullanma: tek alan, `inputMode=numeric placeholder="AA/YY" maxLength=5`, '/' otomatik eklensin, varsayılan boş. CVC: `maxLength=4`. OTP: `autoComplete="one-time-code" inputMode="numeric" maxLength=6` ve görünür etiket.

## F769 — Ödeme hata ve bilgi mesajı en altta, iptal düğmesinin altında; gönder düğmesinden uzak

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Aday                                                |
| Konum               | `src/components/booking/BookingActions.tsx:363`     |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:344-353` |
| Kullanıcılar        | misafir                                             |
| Prensip             | robustness · observability                          |
| Sezgisel madde      | H12 — Feedback                                      |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | area:checkout                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** BookingActions.tsx:363-370 `{message && (<p role={...}>...)}` kapsayıcının en sonunda, kırmızı "Rezervasyonu iptal et" düğmesinin (:344-353) ve StepUpDialog'un altında çiziliyor. Ödeme düğmesi :314-319'da. Hata çıktığında kaydırma ya da odak taşıma yok.

**Etki:** 360 px mobilde kart reddi mesajı ekranın dışında kalıyor. Misafir düğmeye bastığında hiçbir şey olmadığını sanıp tekrar basıyor ve deneme hakkı tükeniyor.

**Önerilen aksiyon:** Mesajı her dalda (mock, Stripe, 3DS) gönder düğmesinin hemen üstünde çizin. Hata ayarlandığında `messageRef.current?.scrollIntoView({ block: "nearest" })` çağırın. İptal sonucu mesajı iptal düğmesinin yanında kalsın.

## F770 — RNPL tahsilatı başarısız olduğunda 'Kartınızı kontrol edin' deniyor ama yapılacak bir eylem sunulmuyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Medium                                   |
| Durum               | Aday                                     |
| Konum               | `src/components/booking/RnplPlan.tsx:56` |
| Diğer konumlar      | `messages/tr/payment.json:49`            |
| Kullanıcılar        | misafir                                  |
| Prensip             | robustness · recoverability              |
| Sezgisel madde      | H9 — Hata mesajları                      |
| Renk/tema           | Hayır                                    |
| Efor                | M                                        |
| Kaynak denetçiler   | area:checkout                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**             |

**Kanıt:** RnplPlan.tsx:56-60 `{plan.status === "RETRYING" && plan.nextAttemptAt && (<p>{t("plan.retry", ...)}</p>)}` → payment.json:49 "Tahsilat başarısız oldu; sonraki deneme: {date}. Kartınızı kontrol edin." Kartı güncelleme düğmesi ya da destek bağlantısı yok. src/app/api/bookings/[id]/rnpl/route.ts yalnızca GET sunuyor; kart güncelleme ucu yok. Ek sürenin son günü de yazılmıyor.

**Etki:** Misafir kartı nasıl değiştireceğini bilmiyor. Ek süre dolunca rezervasyon otomatik iptal ediliyor (stepFailure); konaklama kaybı yaşanıyor.

**Önerilen aksiyon:** RETRYING durumunda "Kartı güncelle" düğmesi ekleyin (yeni setup akışı). Bu akış yoksa en azından `<Link href={`/support?bookingId=${id}`}>Destekle iletişime geç</Link>` verin. Ek sürenin bitişini yazın: "Son ödeme tarihi: {graceUntil}; bu tarihe kadar ödenmezse rezervasyon iptal edilir".

## F771 — Stripe Elements'e dil verilmiyor; kart formu uygulama dilinden farklı görünebiliyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/components/booking/StripePaymentForm.tsx:36` |
| Kullanıcılar        | misafir                                           |
| Prensip             | learnability · consistency                        |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                       |
| WCAG                | 3.1.2                                             |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:checkout                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** StripePaymentForm.tsx:36-42 `options={{ mode: "payment", amount, currency, captureMethod: "manual", paymentMethodCreation: "manual" }}` içinde `locale` yok. Stripe varsayılan olarak tarayıcı dilini (auto) kullanıyor. Stripe'tan dönen hata metinleri (:61, :63, :69 `submitError.message`, `error?.message`, `next.error.message`) de o dilde onError'a aktarılıyor.

**Etki:** TR arayüzü seçmiş ama tarayıcısı EN olan misafir (ya da tersi) ödeme alanlarını ve hata mesajlarını sayfanın geri kalanından farklı dilde görüyor.

**Önerilen aksiyon:** `const locale = useLocale();` ile etkin dili alın ve Elements options'a `locale: locale === "en" ? "en" : "tr"` ekleyin.

## F1077 — Checkout'ta tarihler ISO biçiminde ve oklu ('2027-01-27 → 2027-01-29'); gece sayısı yok

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                           |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                               |
| Konum               | `src/app/checkout/page.tsx:196`                                                               |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:139`, `src/lib/i18n/format.ts:16-20`                           |
| Kullanıcılar        | misafir                                                                                       |
| Prensip             | learnability · Familiarity ve consistency: tarih biçimi yerel ve diğer sayfalarla aynı olmalı |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                   |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | runtime:checkout, area:checkout                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                  |

**Kanıt:** RUNTIME tarama 010/011 (TR) ve 122/123 (EN): 'Giriş – Çıkış 2027-01-27 → 2027-01-29'. Rezervasyon sayfasında aynı tarihler '1 Mart 2027' ve 'April 5, 2027' biçiminde (p2, p9). Ekran görüntüsü: crops/checkout/010-anon-tr-desktop-0.png.

**Etki:** Okuryazarlık düzeyi geniş bir kitle için ISO tarih yavaş okunuyor; ekran okuyucu '→' karakterini 'sağa ok' diye okuyor.

**Önerilen aksiyon:** f.date(checkIn,'long') – f.date(checkOut,'long') ve '(2 gece)' kullanılsın; ok yerine metin ayırıcı konsun.

## F1078 — 3DS kod alanında görünür etiket, one-time-code otomatik doldurma ve ipucu bağlantısı yok

| Alan                | Değer                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                            |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                |
| Konum               | `src/components/booking/BookingActions.tsx:327`                                                |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:326`                                                |
| Kullanıcılar        | misafir                                                                                        |
| Prensip             | accessibility · Substitutivity ve verim: OTP alanı platform otomatik doldurmasını desteklemeli |
| Sezgisel madde      | H7 — Esneklik/verim                                                                            |
| WCAG                | 3.3.2 Labels or Instructions (A)                                                               |
| Renk/tema           | Hayır                                                                                          |
| Efor                | S                                                                                              |
| Kaynak denetçiler   | runtime:checkout, area:checkout                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                   |

**Kanıt:** RUNTIME p7-3ds.mjs: <input inputmode="numeric" aria-label="Doğrulama kodu" required>; autocomplete='', maxLength=-1, aria-describedby=null. Görünür etiket yok, yalnız h2 ve ipucu metni var (crops/checkout/p7-3ds-mobile-tr-challenge.png).

**Etki:** Mobil kullanıcı SMS kodunu klavye önerisinden alamıyor ve alanın amacını görsel etiketten okuyamıyor.

**Önerilen aksiyon:** Görünür bir <label> 'Doğrulama kodu (6 hane)' eklensin; autoComplete='one-time-code', maxLength=6, pattern='\d{6}' verilsin; ipucu metni aria-describedby ile alana bağlansın.

## F1102 — HELD ekranında iki birincil eylem ve 'Rezervasyonu iptal et' ödeme düğmesinin hemen altında

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                   |
| Durum               | Gözlemlendi                                                                           |
| Konum               | `src/components/booking/BookingActions.tsx:344`                                       |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx`                                                       |
| Kullanıcılar        | misafir                                                                               |
| Prensip             | learnability · Minimal tasarım ve hata önleme: tek birincil eylem, yıkıcı eylem ayrık |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                          |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | runtime:checkout                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                          |

**Kanıt:** RUNTIME p4 (masaüstü): 'Öde ve onayla' 672x44 y=879, 'Rezervasyonu iptal et' 186x46 y=939 (araları 16px), 'Konaklamayı Görüntüle' y=1034 ve birincil lacivert stilde (crops/checkout/p2-desktop-booking-s-0.png ve s-1). Onaydan sonra görünüm iptal düğmesinin bulunduğu yerde kalıyor (p5-retry-s-0.png).

**Etki:** Ödeme adımında dikkat dağılıyor; aceleci dokunuşta iptal akışı tetiklenebiliyor (confirm ile korunuyor).

**Önerilen aksiyon:** HELD durumunda 'Konaklamayı Görüntüle' ikincil stile alınsın; iptal eylemi ödeme formundan ayrılıp 'Diğer seçenekler' altında bir metin bağlantısı olarak sunulsun.

## F1227 — Özet satırlarında dt ile dd arasında boşluk ve sağa hizalama yok; 360 px'te uzun değerler dağınık kırılıyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Aday                            |
| Konum               | `src/app/checkout/page.tsx:173` |
| Kullanıcılar        | misafir                         |
| Prensip             | learnability · synthesizability |
| Sezgisel madde      | H8 — Estetik/minimal tasarım    |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:checkout                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**    |

**Kanıt:** checkout/page.tsx:173, 178, 186, 193, 199 `<div className="flex justify-between">`: gap yok ve dd öğelerinde text-right yok. Uzun bir konaklama adı ya da "Loft (Çift Kişilik Yatak)" gibi oda adları 360 px genişlikte (kart içi yaklaşık 280 px) birkaç satıra kırılıyor, sola hizalanıyor ve etiketle bitişik duruyor.

**Etki:** Mobildeki misafir hangi değerin hangi etikete ait olduğunu ayırt etmekte zorlanıyor.

**Önerilen aksiyon:** Satırlara `gap-4`, dd'lere `text-right` ekleyin. 360 px altında `flex-col sm:flex-row` ile alt alta dizilime geçin.

## F1228 — Yükleniyor yer tutucuları ekran okuyucuya anlamlı gelmiyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Aday                            |
| Konum               | `src/app/checkout/page.tsx:175` |
| Diğer konumlar      | `src/app/checkout/page.tsx:251` |
| Kullanıcılar        | misafir                         |
| Prensip             | accessibility · Durum mesajları |
| Sezgisel madde      | H12 — Feedback                  |
| WCAG                | 4.1.3                           |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:checkout                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**    |

**Kanıt:** checkout/page.tsx:175 `{property?.title ?? "…"}`: ekran okuyucu bunu "yatay üç nokta" diye okuyor. :251 Suspense yedeğindeki `<p className="text-gray-500">{t("loading")}</p>` role="status" taşımıyor. Oda satırı (:185) yükleme bitince sonradan ekleniyor ve sayfa kayıyor.

**Etki:** Ekran okuyucu kullanıcısı sayfanın yüklendiğini ya da başlığın beklendiğini anlamıyor.

**Önerilen aksiyon:** Yer tutucuyu `<span aria-hidden="true">…</span><span className="sr-only">{t("loading")}</span>` yapın. Suspense yedeğindeki p'ye `role="status"` ekleyin. Oda satırı için yükleme sırasında da aynı yükseklikte bir iskelet satırı gösterin.

## F1229 — Ödeme zamanı ve kredi seçenekleri 'Ödeme' başlığının üstünde ve formun dışında

| Alan                | Değer                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                              |
| Durum               | Aday                                                                                             |
| Konum               | `src/components/booking/BookingActions.tsx:238`                                                  |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:252`, `src/components/booking/BookingActions.tsx:267` |
| Kullanıcılar        | misafir                                                                                          |
| Prensip             | accessibility · Bilgi ve ilişkiler / başlık yapısı                                               |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                      |
| WCAG                | 1.3.1                                                                                            |
| Renk/tema           | Hayır                                                                                            |
| Efor                | S                                                                                                |
| Kaynak denetçiler   | area:checkout                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                     |

**Kanıt:** BookingActions.tsx:238-249 RnplOption ve WalletCreditOption fieldset'leri, h2 `{t("title")}` başlığından (:252, :267) önce ve `<form onSubmit={pay}>` (:266) dışında çiziliyor. docs/img/v5-rnpl-checkout.png'de "Ödeme zamanı" seçimi "Ödeme" başlığının üstünde görünüyor.

**Etki:** Başlıklarla gezinen ekran okuyucu kullanıcısı "Ödeme" başlığına atladığında ödeme zamanı ve kredi seçimini atlıyor. Görsel gruplama da seçeneklerin ödeme bölümüne ait olduğunu göstermiyor.

**Önerilen aksiyon:** HELD bloğunun en üstüne tek bir h2 "Ödeme" koyun. Altına sırayla ödeme zamanı, kredi ve kart formunu yerleştirin. İki daldaki tekrarlı h2'leri (:252, :267) kaldırın.

## F1230 — Ödeme butonlarında tahsil edilecek tutar ekranlar arasında tutarsız

| Alan                | Değer                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                               |
| Durum               | Aday                                                                                                                              |
| Konum               | `src/components/booking/BookingActions.tsx:318`                                                                                   |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:346`, `src/app/pay/share/[token]/page.tsx:289`, `src/components/booking/StripePaymentForm.tsx:83` |
| Kullanıcılar        | misafir                                                                                                                           |
| Prensip             | learnability · consistency                                                                                                        |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                       |
| Renk/tema           | Hayır                                                                                                                             |
| Efor                | S                                                                                                                                 |
| Kaynak denetçiler   | lens:status                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                      |

**Kanıt:** BookingActions.tsx:318 `{busy ? t("processing") : rnpl ? t("rnpl.reserve") : t("payAndConfirm")}` tutarsız (tutar yok); cüzdan kredisi seçilince WalletCreditOption 'Kart ile ödenecek: …' gösteriyor ama buton güncellenmiyor. Oysa checkout/cart/page.tsx:346 ve pay/share/[token]/page.tsx:289 butonda tutarı gösteriyor.

**Etki:** Misafir tek oda ödemesinde karttan ne kadar çekileceğini son tıklamada görmüyor; sepet akışıyla farklı davranış öğrenmeyi zorlaştırıyor.

**Önerilen aksiyon:** Butonu 'Öde ve onayla · {f.money(amountMinor - creditMinor)}' olarak biçimlendir; StripePaymentForm butonunda da aynı.

## F1231 — Meşgul durumda devre dışı iptal düğmeleri etkin görünüyor; iptal sırasında 'işleniyor' metni yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/booking/BookingActions.tsx:348` |
| Diğer konumlar      | `src/components/booking/StepUpDialog.tsx:82-89` |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · predictability (affordance)      |
| Sezgisel madde      | H11 — Affordance                                |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:checkout                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** BookingActions.tsx:345-352 `disabled={busy}` verilmiş ama className'de disabled: varyantı yok; metin sabit `{t("cancel.button")}`. DELETE isteği (:209-213) sürerken düğme görünüşte değişmiyor. StepUpDialog.tsx:82-86 "Vazgeç" düğmesi de `disabled={busy}` ile aynı durumda. Paylaşılan Button (ui.tsx:38) ise `disabled:cursor-not-allowed disabled:opacity-60` kullanıyor.

**Etki:** Misafir düğmeye tekrar tekrar basıyor ve tepki alamıyor; işlemin sürdüğünü anlamıyor.

**Önerilen aksiyon:** İki düğmeye de `disabled:cursor-not-allowed disabled:opacity-60` ekleyin ya da ui.tsx'teki Button'ı kullanın. İptal düğmesinin metnini `{busy ? t("cancel.processing") : t("cancel.button")}` yapın ("İptal ediliyor…").

## F1232 — Step-up 'Vazgeç' sonrası geri bildirim yok; bekleyen ödeme sessizce düşüyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/booking/BookingActions.tsx:359` |
| Diğer konumlar      | `src/components/booking/StepUpDialog.tsx:82-89` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · observability                      |
| Sezgisel madde      | H12 — Feedback                                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:checkout                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** BookingActions.tsx:359 `onCancel={() => setStepUp(null)}`: mesaj ayarlanmıyor ve mock akışta :175 `setStepUp({ cardToken })` ile saklanan token atılıyor. İletişim kutusu kapanıyor; kullanıcı dolu kart formuna geri dönüyor ama ödemenin yapılmadığına dair bir metin görmüyor.

**Etki:** Misafir vazgeçtiği hâlde ödemenin bir şekilde yapıldığını sanabiliyor ya da neden tekrar sorulduğunu anlamıyor.

**Önerilen aksiyon:** onCancel içinde `setMessage({ kind: "info", text: t("stepUp.cancelled") })` çağırın; metin "Ödeme yapılmadı. Oda {time} saatine kadar tutuluyor; dilediğinizde yeniden deneyebilirsiniz." olsun. Ardından odağı ödeme düğmesine taşıyın.

## F1233 — Ek doğrulama (step-up) iptal edilince ödeme durumu açıklanmıyor ve odak tetikleyiciye dönmüyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/booking/BookingActions.tsx:359` |
| Diğer konumlar      | `src/components/booking/StepUpDialog.tsx:29`    |
| Kullanıcılar        | misafir                                         |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order          |
| Sezgisel madde      | H12 — Feedback                                  |
| WCAG                | 2.4.3                                           |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | lens:status                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** BookingActions.tsx:355-361 `onCancel={() => setStepUp(null)}` — mesaj yok; StepUpDialog.tsx açılışta odağı primary butona taşıyor (iyi) ama kapanışta tetikleyiciye geri vermiyor.

**Etki:** Misafir ödemenin yapılıp yapılmadığından emin olamıyor; klavye kullanıcısı odağı kaybediyor.

**Önerilen aksiyon:** İptalde role=status 'Ödeme tamamlanmadı; dilediğinizde yeniden deneyebilirsiniz' ve odağı 'Öde ve onayla' butonuna geri ver.

## F1234 — Doğrulama sürerken Escape iletişim kutusunu kapatıyor ama işlem arkada sürüyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Low                                                |
| Durum               | Aday                                               |
| Konum               | `src/components/booking/StepUpDialog.tsx:31`       |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:98-104` |
| Kullanıcılar        | misafir                                            |
| Prensip             | learnability · consistency                         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                        |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | area:checkout                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** StepUpDialog.tsx:31 `if (e.key === "Escape") onCancel();` busy durumunu kontrol etmiyor, oysa "Vazgeç" düğmesi :85'te `disabled={busy}`. performStepUp (:41) kapanıştan sonra da tamamlanıp `onVerified` çağırıyor. BookingActions.tsx:99-104'te `pending` null olduğu için kullanıcı vazgeçmiş olsa da beklenmedik biçimde "Doğrulandı. Ödemeyi yeniden gönderebilirsiniz." görüyor.

**Etki:** Klavye kullanıcısı için düğme ile Escape tutarsız davranıyor. İptal edildiğini sandığı işlem sonradan "doğrulandı" diye geri dönüyor.

**Önerilen aksiyon:** Escape işleyicisine busy kontrolü ekleyin (`busyRef.current` ile). Alternatif olarak WebAuthn törenini AbortController ile iptal edin ve iptalden sonra onVerified çağrılmasın.

## F1235 — Ek doğrulama (step-up) penceresi iptal edilince ödeme yapılmadığı söylenmiyor; meşgulken Escape iptal ediyor

| Alan                | Değer                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                  |
| Durum               | Aday                                                                                                 |
| Konum               | `src/components/booking/StepUpDialog.tsx:31`                                                         |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:355-361`, `src/components/account/ReauthDialog.tsx:42-49` |
| Kullanıcılar        | misafir                                                                                              |
| Prensip             | robustness · observability                                                                           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                       |
| WCAG                | 2.4.3                                                                                                |
| Renk/tema           | Hayır                                                                                                |
| Efor                | S                                                                                                    |
| Kaynak denetçiler   | lens:forms                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                         |

**Kanıt:** src/components/booking/StepUpDialog.tsx:28-35 Escape her durumda `onCancel()` (passkey töreni sürerken de); src/components/booking/BookingActions.tsx:355-361 `onCancel={() => setStepUp(null)}` sonrasında mesaj yok. Diyalog odak tuzağı içermiyor ve kapanınca odak tetikleyiciye dönmüyor.

**Etki:** Misafir pencereyi kapatınca ödemenin yapılıp yapılmadığından emin olamaz; çift ödeme korkusuyla destek arar.

**Önerilen aksiyon:** İptalde `setMessage({ kind: "info", text: t("stepUp.cancelledNoCharge") })` ('Ödeme yapılmadı; tekrar deneyebilirsiniz'); busy iken Escape'i yok say; odak tuzağı ve kapanışta odağı ödeme düğmesine döndür.

## F1236 — 'Passkey'lerimi yönet' bağlantısı aynı sekmede ödeme bağlamını terk ettiriyor

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/booking/StepUpDialog.tsx:67` |
| Kullanıcılar        | misafir                                      |
| Prensip             | robustness · recoverability                  |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü            |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:checkout                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** StepUpDialog.tsx:67 `<Link href="/account" className="font-semibold underline">`: hata metninin içinde, uyarı vermeden ve dönüş adresi olmadan /account sayfasına gidiyor. Bu sırada HELD rezervasyonun 15 dakikalık süresi işlemeye devam ediyor (app-config.ts:53).

**Etki:** Misafir passkey ekleyip ödeme sayfasına nasıl döneceğini bilemiyor ve tutma süresini kaçırabiliyor.

**Önerilen aksiyon:** Bağlantıya `href={`/account?returnTo=/booking/${bookingId}`}` verin ve hesap sayfasında "Ödemeye dön" bağlantısı gösterin. Alternatif olarak `target="_blank" rel="noopener"` ile yeni sekmede açın ve görünür "(yeni sekmede açılır)" ibaresi ekleyin.

## F1237 — Step-up bekleme metni 'Bekleniyor...' neyin beklendiğini söylemiyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Low                                                          |
| Durum               | Aday                                                         |
| Konum               | `src/components/booking/StepUpDialog.tsx:80`                 |
| Diğer konumlar      | `messages/tr/payment.json:32`, `messages/en/payment.json:32` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | robustness · observability                                   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                               |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:checkout                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** StepUpDialog.tsx:80 `{busy ? t("waiting") : t("verify")}`, payment.json:32 "Bekleniyor...". Passkey istemi işletim sistemi penceresinde ya da telefonda açılıyor; düğme metni kullanıcının nereye bakması gerektiğini söylemiyor ve role=status ile duyurulmuyor.

**Etki:** Passkey'e yeni alışan misafir sistem istemini görmezse ekranın donduğunu sanıyor.

**Önerilen aksiyon:** Metni "Cihazınızdaki passkey onayı bekleniyor…" yapın ve düğmenin altına `<p role="status">` ile aynı metni ekleyin. Telefon üzerinden doğrulama için "Telefonunuzda gelen isteği onaylayın" ipucu verin.

## F1238 — Stripe doğrulama hataları iki kez gösteriliyor ve duyuruluyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Low                                                 |
| Durum               | Aday                                                |
| Konum               | `src/components/booking/StripePaymentForm.tsx:61`   |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:363-369` |
| Kullanıcılar        | misafir                                             |
| Prensip             | accessibility · Durum mesajları (yinelenen duyuru)  |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                        |
| WCAG                | 4.1.3                                               |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | area:checkout                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** StripePaymentForm.tsx:60-61 `const { error: submitError } = await elements.submit(); if (submitError) return onError(submitError.message ...)`. PaymentElement bu doğrulama hatasını kendi alanının altında zaten gösteriyor. onError bunu ayrıca BookingActions.tsx:363-369'da `role="alert"` olarak tekrar basıyor.

**Etki:** Ekran okuyucu aynı hatayı iki kez duyuruyor. Görsel olarak aynı mesaj formun içinde ve en altta tekrar ediyor.

**Önerilen aksiyon:** `elements.submit()` doğrulama hatalarında onError çağırmayın; yalnızca odağı PaymentElement'e verin (`elements.getElement('payment')?.focus()`). onError createPaymentMethod, sunucu ve 3DS hataları için kalsın.
