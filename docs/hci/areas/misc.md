# Destek, devir pazarı, seyahat planlayıcı — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 55 bulgu · Severity: Critical 1, High 14, Medium 31, Low 9

## F13 — Devralma ödemesi rezervasyon ve tutar özeti gösterilmeden alınıyor

| Alan                | Değer                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                                                     |
| Durum               | Aday (3 kaynak birleşti)                                                                                                                                                                                                     |
| Konum               | `src/components/transfers/ClaimForm.tsx:104`                                                                                                                                                                                 |
| Diğer konumlar      | `src/app/api/transfers/claim/route.ts:15`, `messages/tr/transfers.json:44`, `messages/en/transfers.json:44`, `src/app/transfers/claim/page.tsx:8-14`, `src/app/transfers/claim/page.tsx:11`, `messages/tr/transfers.json:23` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                      |
| Prensip             | robustness · observability / feedforward; WCAG 3.3.4 Hata Önleme (finansal)                                                                                                                                                  |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                                                                            |
| WCAG                | 3.3.4                                                                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                                        |
| Efor                | M                                                                                                                                                                                                                            |
| Kaynak denetçiler   | area:misc, lens:forms, lens:copy                                                                                                                                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: misc)                                                                                                                                                                                          |

**Kanıt:** ClaimForm.tsx:104-165 formda yalnızca kart alanları var. 161-162 `{busy ? t("processing") : t("submit")}` metni 'Öde ve devral' (tr/transfers.json:44) ve tutar içermiyor. Tutar ilk kez başarıdan SONRA görünüyor: 68-70 `t("done", { amount: f.money(res.paidMinor, res.currency) })`. src/app/api/transfers/claim/route.ts yalnızca POST içeriyor, token için önizleme ucu yok. Mülk, şehir, tarihler, misafir sayısı ve istenen fiyat hiçbir yerde gösterilmiyor.

**Etki:** Misafir (alıcı), satıcının WhatsApp veya e-posta ile gönderdiği bağlantıyı açıp kartını giriyor. Hangi tesisi, hangi tarihleri ve ne kadara aldığını görmeden çekim yapılıyor. Satıcı fiyatı değiştirip bağlantıyı yenilediyse alıcı farkı ödeme sonrası fark ediyor. Ayrıca ödemeyi gözden geçirme veya onaylama adımı yok (3.3.4).

**Önerilen aksiyon:** Token'ı gövdede taşıyan bir önizleme ucu ekleyin (POST /api/transfers/claim/preview {token}; logları temiz tutmak için GET kullanmayın). Bu uç property.title, city, checkIn/checkOut, guestCount, askPriceMinor, originalPriceMinor ve expiresAt döndürsün. ClaimForm kart alanlarının üstünde bunları bir <dl> özet kartında göstersin. Gönder düğmesinin metni t('submitAmount', {amount}) olsun ('{amount} öde ve devral'). Düğmenin yanına 'Bilgileri kontrol ettim' onay kutusu ya da ikinci bir onay adımı ekleyin.

**Yapılan düzeltme:** ClaimForm.tsx: added a note above the card fields telling the buyer to confirm the property, dates and price with the seller (claim.reviewNote). A useConfirm step now runs before the charge (claim.confirmTitle/confirmBody/confirmAction, tone primary). The submit is guarded against double clicks, the form has aria-busy, and a card validation error moves focus to the card number field. A summary card with property, dates and amount, and a button label that includes the amount, both need a token preview endpoint (POST /api/transfers/claim/preview) that does not exist, so that part needs backend/API change. — dosyalar: `src/components/transfers/ClaimForm.tsx`

## F174 — Gezi planında bir durağı 'Tut'mak sayfadan çıkarıyor; plan kayboluyor, diğer duraklar tutulamıyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Aday (2 kaynak birleşti)                        |
| Konum               | `src/components/plan/TripPlanner.tsx:104`       |
| Diğer konumlar      | `src/components/plan/TripPlanner.tsx:52`        |
| Kullanıcılar        | misafir                                         |
| Prensip             | flexibility · multithreading / task conformance |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü               |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:misc, lens:nav                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: misc)             |

**Kanıt:** TripPlanner.tsx:104 `router.push(`/booking/${booking.id}`)`. Plan ve anahtarlar yalnızca bileşen state'inde duruyor (52-53 `useState<TripPlan | null>(null)`, `keys`). Geri dönünce form varsayılanlara dönüyor (48-51), plan gidiyor. Yeniden planlamada 78 `setKeys(res.stops.map(() => newIdempotencyKey()))` yeni anahtarlar üretiyor.

**Etki:** Çok şehirli gezi planlayan misafir 1. durağı tutar tutmaz ödeme sayfasına atılıyor. 2. ve 3. durak için planı yeniden oluşturması gerekiyor; yeni planda konaklamalar ve fiyatlar değişebiliyor. 1. durağı yeniden tutmaya çalışırsa yeni idempotency anahtarı yüzünden ikinci bir tutma oluşabiliyor. Planlayıcının asıl amacı olan tüm rotayı ayırma bu haliyle yapılamıyor.

**Önerilen aksiyon:** Hold sonrası yönlendirmeyi kaldırın. Durağın satırında 'Tutuldu, 15 dk içinde ödeyin' durumu ve `/booking/{id}` bağlantısı ('Öde') gösterin. Plan, istek parametreleri, anahtarlar ve tutulan rezervasyon id'lerini sessionStorage'da saklayın (try/catch içinde) ve sayfa açılışında geri yükleyin. 'Tüm durakları tut' veya 'Sepete ekle' (/cart grup sepeti) seçeneği ekleyin.

**Yapılan düzeltme:** TripPlanner.tsx: removed the redirect after a hold. The stop row now shows 'Tutuldu' and a /booking/{id} 'Öde' link (44px on mobile). A 'Tutulan durak: x/y' summary was added. The form fields, plan, idempotency keys and held booking ids are saved to sessionStorage (in try/catch) and restored when the page opens, so re-holding uses the same key. 'Hold all stops / add to cart' is a new flow and was not added (needs product decision). — dosyalar: `src/components/plan/TripPlanner.tsx`

## F301 — Oturumsuz alıcı giriş yaptıktan sonra devir bağlantısındaki token kayboluyor

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | High                                                                        |
| Durum               | Aday                                                                        |
| Konum               | `src/app/transfers/claim/page.tsx:12`                                       |
| Diğer konumlar      | `src/components/ui/ui.tsx:219`, `src/components/transfers/ClaimForm.tsx:25` |
| Kullanıcılar        | misafir                                                                     |
| Prensip             | flexibility · task migratability (görev sürekliliği)                        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                           |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | area:misc                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                                |

**Kanıt:** claim/page.tsx:12 `<RoleGate>{() => <ClaimForm />}</RoleGate>`. Oturum yoksa ui.tsx:219 `<Link href="/login" ...>` gösteriliyor ve redirect parametresi verilmiyor. login/page.tsx:63 `get("redirect") ?? "/"` olduğu için kullanıcı '/' adresine gidiyor. Token yalnızca hash içinde duruyor (ClaimForm.tsx:25-27 `window.location.hash`) ve başka bir yerde saklanmıyor.

**Etki:** Bağlantıyı mobilde oturum açmadan açan misafir 'giriş yapın' bağlantısına dokunuyor, giriş yapınca ana sayfaya düşüyor. /transfers/claim sayfasına elle dönerse 'Geçerli bir devir bağlantısı bulunamadı' uyarısını görüyor. Bağlantıyı mesaj uygulamasında yeniden bulmak zorunda kalıyor. Okuryazarlığı düşük kullanıcı için devir burada bitebilir.

**Önerilen aksiyon:** Claim sayfasında giriş bağlantısını göstermeden önce `sessionStorage.setItem('transfer-claim-token', token)` ile token'ı saklayın (try/catch içinde). Giriş bağlantısını `/login?redirect=%2Ftransfers%2Fclaim` yapın. ClaimForm.readToken önce hash'e, yoksa sessionStorage'a baksın; başarıdan sonra sessionStorage kaydını silsin. Aynı redirect'li bir 'Kayıt ol' bağlantısı da ekleyin. Token'ı query string'e koymayın.

**Yapılan düzeltme:** transfers/claim/page.tsx: when signed out, the page no longer uses RoleGate. It calls stashClaimToken() in an effect, which writes the hash token to sessionStorage, and shows its own message (claim.loginPrompt) with loginHref('/transfers/claim') and loginHref('/transfers/claim','/register') links. Only the path goes into redirect; the token is never put in a query string. ClaimForm.readToken reads the hash first, then sessionStorage, and the stored token is deleted after a successful claim. — dosyalar: `src/app/transfers/claim/page.tsx`, `src/components/transfers/ClaimForm.tsx`

## F302 — Devir (transfer) bağlantısı oturum yokken giriş sonrasında token'ı kaybediyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | High                                        |
| Durum               | Aday                                        |
| Konum               | `src/app/transfers/claim/page.tsx:12`       |
| Diğer konumlar      | `src/components/transfers/ClaimForm.tsx:24` |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | lens:nav                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                |

**Kanıt:** ClaimForm.tsx:24-28 token'ı `window.location.hash` içinden okuyor (`#token=…`). transfers/claim/page.tsx:12 `<RoleGate>{() => <ClaimForm />}</RoleGate>` oturum yoksa ui.tsx:219 `href="/login"` gösteriyor, login sonrası "/"a gidiliyor. Kod tabanındaki redirect üreten yerler de yalnız `window.location.pathname` kullanıyor (useCart.ts:24, pay/share:77), yani hash zaten taşınmıyor. Linke elle dönülürse ClaimForm.tsx:80-86 `invalidLink` gösteriyor.

**Etki:** Satıcının paylaştığı devir linkini oturumsuz açan alıcı giriş ya da kayıt sonrası token'ı kaybediyor. Devralma ancak orijinal mesaja dönüp linki yeniden açarsa mümkün; süre baskısı altındaki bir devir başarısız olabilir.

**Önerilen aksiyon:** Bu sayfanın giriş bağlantısı `pathname + search + hash` değerini redirect'e koysun; login/register sonrası `router.push(redirect)` hash'i korur. Alternatif olarak giriş öncesi token'ı sessionStorage'a yazıp ClaimForm'da geri yükleyin. Oturumsuz durumda "Devri tamamlamak için giriş yapın; bağlantınız korunacak" açıklamasını gösterin.

**Yapılan düzeltme:** Same change as F301: the token is kept in sessionStorage, the login/register links carry a redirect, and the message tells the user 'Bağlantınız bu sekmede korunur'. — dosyalar: `src/app/transfers/claim/page.tsx`, `src/components/transfers/ClaimForm.tsx`

## F303 — Sayfa başlıkları (<title>) ekrana özgü değil

| Alan                | Değer                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                     |
| Durum               | Aday                                                                                                                                                     |
| Konum               | `src/app/transfers/page.tsx:8`                                                                                                                           |
| Diğer konumlar      | `src/app/transfers/claim/page.tsx:8`, `src/app/support/page.tsx:8`, `src/app/plan/page.tsx:8`, `src/app/dev/mailbox/page.tsx:6`, `src/app/layout.tsx:13` |
| Kullanıcılar        | tümü                                                                                                                                                     |
| Prensip             | accessibility · WCAG 2.4.2 Sayfa Başlığı                                                                                                                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                    |
| WCAG                | 2.4.2                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                    |
| Efor                | S                                                                                                                                                        |
| Kaynak denetçiler   | area:misc                                                                                                                                                |
| **Düzeltme durumu** | **Zaten uygun** (paket: misc)                                                                                                                            |

**Kanıt:** Beş sayfa da istemci bileşeni ('use client') ve metadata ya da generateMetadata tanımlamıyor: transfers/page.tsx:8, transfers/claim/page.tsx:8, support/page.tsx:8, plan/page.tsx:8, dev/mailbox/page.tsx:6. Tek başlık kaynağı layout.tsx:13-17 `title: t("meta.title")`, değeri 'booking-platform — konaklama arama ve rezervasyon (demo)' (tr/common.json:3).

**Etki:** Ekran okuyucu kullanıcısı sayfa değişince hangi ekranda olduğunu başlıktan anlayamıyor. Birden çok sekme açan kullanıcı (ilan + devir bağlantısı + destek) sekmeleri ayırt edemiyor. Geçmiş ve yer imleri aynı adla görünüyor.

**Önerilen aksiyon:** Her rota klasörüne generateMetadata içeren bir sunucu layout.tsx ekleyin (önce node_modules/next/dist/docs içindeki metadata rehberini kontrol edin). Örnek: transfers/layout.tsx `title: `${t('transfers.page.title')} · booking (demo)``. claim sayfası için 'Rezervasyonu devral', support için 'Destek asistanı', plan için 'Gezi planlayıcı', mailbox için 'Posta kutusu (demo)' kullanılsın.

**Yapılan düzeltme:** Page titles are handled globally in wave 1 (the task forbids adding titles or metadata). No change.

## F304 — Gezi planı doğrulama hatası hangi alanın hatalı olduğunu söylemiyor

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | High                                                                |
| Durum               | Aday                                                                |
| Konum               | `src/components/plan/TripPlanner.tsx:80`                            |
| Diğer konumlar      | `src/lib/http/errors.ts:153`, `src/app/api/ai/trip-plan/route.ts:9` |
| Kullanıcılar        | misafir                                                             |
| Prensip             | accessibility · WCAG 3.3.1 Hata Tanımlama                           |
| Sezgisel madde      | H9 — Hata mesajları                                                 |
| WCAG                | 3.3.1                                                               |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | area:misc                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                        |

**Kanıt:** TripPlanner.tsx:80 `setError(errorMessage(err, tc("unexpectedError")))` yalnızca message'ı gösteriyor. ZodError için sunucu errors.ts:152-156 `{ error: "Doğrulama hatası", code: "VALIDATION_ERROR", details: error.flatten() }` döndürüyor, `details` kullanılmıyor. Şema api/ai/trip-plan/route.ts:9 `cities: z.array(z.string().trim().min(2).max(60)).min(1).max(6)`. İstemci şehir sayısını ve uzunluğunu kontrol etmiyor (116-124). Field error prop'u kullanılmıyor.

**Etki:** 7 şehir yazan ya da 'İzmir, A' gibi tek harfli giriş yapan misafir yalnızca 'Doğrulama hatası' görüyor. Hangi alanın neden hatalı olduğunu bilmiyor. Ekran okuyucu kullanıcısı hatalı alana yönlendirilmiyor.

**Önerilen aksiyon:** Gönderimden önce istemci tarafında doğrulayın: şehir sayısı 1–6, her şehir en az 2 karakter, gün sayısı ≥ şehir sayısı. Hata olursa Field'a `error={citiesError}` geçin; bu aria-invalid ve aria-describedby'yi bağlar. İlk hatalı alana focus() yapın. Sunucudan VALIDATION_ERROR gelirse `details.fieldErrors` anahtarlarını (cities/days/guests/startDate) ilgili Field'a eşleyin. Metinler plan.json'a eklensin ('En fazla 6 şehir girin; şu an {n}').

**Yapılan düzeltme:** TripPlanner.tsx: added client-side checks before submit (1-6 cities, each 2-60 characters). Errors go to the Field error prop (aria-invalid/aria-describedby) and focus moves to the first invalid field. A server VALIDATION_ERROR is mapped from details.fieldErrors to the cities, days, guests and startDate fields (plan.errors.invalid.*). Added an example-format hint to the cities field and switched to useErrorText. The 'days >= city count' rule was not added because the server does not enforce it. — dosyalar: `src/components/plan/TripPlanner.tsx`

## F305 — Seyahat planlayıcıda 'Tut' /booking/undefined'a gidiyor: tutma oluşsa da kullanıcı 'Hata' görüyor ve plan kayboluyor

| Alan                | Değer                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                  |
| Durum               | Aday                                                                                                  |
| Konum               | `src/components/plan/TripPlanner.tsx:104`                                                             |
| Diğer konumlar      | `src/app/api/bookings/route.ts:24`, `src/lib/booking-service.ts:159`, `src/app/checkout/page.tsx:139` |
| Kullanıcılar        | misafir                                                                                               |
| Prensip             | robustness · task conformance                                                                         |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                        |
| Renk/tema           | Hayır                                                                                                 |
| Efor                | S                                                                                                     |
| Kaynak denetçiler   | lens:status                                                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                                                          |

**Kanıt:** TripPlanner.tsx:92 `const booking = await apiFetch<{ id: string }>("/api/bookings", …)` ve 104 `router.push(\`/booking/${booking.id}\`)`; oysa api/bookings/route.ts:24 `NextResponse.json(booking, { status: 201 })`ve lib/booking-service.ts:159-162`BookingResult { booking: BookingDTO; paymentRequired }`→`booking.id` undefined. checkout/page.tsx:139 doğru alanı (`data?.booking?.id`) kullanıyor. Plan yalnız useState'te (52), sayfadan ayrılınca kayboluyor.

**Etki:** Misafir çok duraklı planda bir durağı tuttuğunda booking/[id] 'Hata · Kayıt bulunamadı' gösteriyor; arka planda HELD rezervasyon görünmeden 15 dk sonra düşüyor; diğer duraklar için planı (LLM) yeniden üretmesi ve farklı sonuç alması gerekiyor.

**Önerilen aksiyon:** `apiFetch<{ booking: { id: string } }>` ve `res.booking.id` kullan. Sayfadan ayrılmak yerine durak satırında 'İstanbul 15 dk tutuldu — Öde' bağlantısı ve 'Tutulan: 1/3' özeti; planı sessionStorage'da sakla, dönüşte geri yükle.

**Yapılan düzeltme:** TripPlanner.tsx hold(): now uses apiFetch<{ booking: { id: string } }> and res.booking.id, so /booking/undefined no longer happens. There is no navigation; the held state and pay link show in the stop row, and the plan persists in sessionStorage (same change as F174). — dosyalar: `src/components/plan/TripPlanner.tsx`

## F306 — Destek sohbetinde rezervasyon seçilemiyor; asistan rastgele ilk rezervasyon için yanıt veriyor

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | High                                                            |
| Durum               | Aday                                                            |
| Konum               | `src/components/support/SupportChat.tsx:50`                     |
| Diğer konumlar      | `src/lib/http/api-schemas.ts:77`, `src/lib/support/repo.ts:110` |
| Kullanıcılar        | misafir                                                         |
| Prensip             | robustness · task conformance                                   |
| Sezgisel madde      | H13 — Feedforward                                               |
| Renk/tema           | Hayır                                                           |
| Efor                | M                                                               |
| Kaynak denetçiler   | area:misc                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                    |

**Kanıt:** SupportChat.tsx:50-54 istek gövdesinde yalnızca `message`, `locale` ve `requestHuman` var. api-schemas.ts:77 `bookingId` kabul ediyor ama UI göndermiyor. repo.ts:110-111 bookingId yoksa `where: { userId, checkOut: { gte: new Date() } }, orderBy: { checkIn: "asc" }` ile en yakın rezervasyonu seçiyor. Yanıtın hangi rezervasyonla ilgili olduğu UI'da ayrıca gösterilmiyor.

**Etki:** İki yaklaşan rezervasyonu olan misafir ikincisi için 'İptal edersem ne kadar iade alırım?' diye soruyor ve birincisinin iade tahminini alıyor. İptal (para) kararını yanlış bilgiyle verebilir.

**Önerilen aksiyon:** Textarea'nın üstüne 'Hangi rezervasyon hakkında?' etiketli bir <select> koyun. Seçenekler /api/bookings'ten gelsin, varsayılan en yakın rezervasyon olsun; seçilen değer `bookingId` olarak gönderilsin. /support?bookingId= sorgu parametresini destekleyin ve rezervasyon detay sayfasına 'Bu rezervasyon için destek' bağlantısı ekleyin. Her asistan yanıtının üstünde '{tesis} · {tarih}' bağlam satırı gösterin.

**Yapılan düzeltme:** SupportChat.tsx: added a 'Hangi rezervasyon hakkında?' <select> with a label above the textarea. It is filled from /api/bookings with upcoming bookings that are not cancelled, sorted by check-in, and the nearest one is selected by default. The chosen id is sent in the request body as bookingId. Supports /support?bookingId=. Each assistant reply shows a 'Rezervasyon: {tesis · tarih}' context line. The form has aria-busy, and useErrorText is used. The 'Bu rezervasyon için destek' link on the booking detail page belongs to another owner (see crossOwner). — dosyalar: `src/components/support/SupportChat.tsx`

## F307 — Ağ kopması sonrası yeniden denemede ödeme yapmış alıcıya 'devir artık mevcut değil' deniyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | High                                        |
| Durum               | Aday                                        |
| Konum               | `src/components/transfers/ClaimForm.tsx:63` |
| Diğer konumlar      | `src/lib/transfer/transfer-service.ts:678`  |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · observability / recoverability |
| Sezgisel madde      | H12 — Feedback                              |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:misc                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: misc)         |

**Kanıt:** ClaimForm.tsx:63-66 `apiFetch("/api/transfers/claim", { method: "POST", body: ... })` Idempotency-Key başlığı göndermiyor. TripPlanner.tsx:94 ise gönderiyor. Sunucu tarafında transfer-service.ts:678-680 `if (transfer.status !== TransferStatus.LISTED) throw ... "Bu devir artık mevcut değil"` kontrolü claimedById (426) alıcıyla karşılaştırılmadan önce çalışıyor.

**Etki:** Mobil ağda istek sunucuda tahsil edilip tamamlanıyor ama yanıt istemciye ulaşmıyor; kullanıcı 'Failed to fetch' görüyor. Tekrar 'Öde ve devral'a basınca 409 'Bu devir artık mevcut değil' alıyor. Parası çekilmiş olan misafir rezervasyonu kaybettiğini sanıyor ve destek ya da itiraz yoluna gidiyor. CAPTURE_PENDING durumunda yeniden denediğinde de aynı yanıltıcı mesajı alıyor.

**Önerilen aksiyon:** İstemci: form başına bir `newIdempotencyKey()` üretip `headers: { 'Idempotency-Key': key }` ile gönderin; yeni kart girilince anahtarı yenileyin. Sunucu: `status === COMPLETED && claimedById === buyerId` ise 200 ve ClaimResult dönün; `CAPTURE_PENDING` durumunda aynı alıcıya 202 ve 'Ödemeniz işleniyor' dönün. İstemci 409 ALREADY_CLAIMED aldığında /api/bookings ile sahipliği kontrol edip 'Rezervasyon zaten sizin' durumunu göstersin.

**Yapılan düzeltme:** ClaimForm.tsx: one Idempotency-Key per form, sent in the header, and renewed when the card number changes. If a 409 follows an earlier attempt, a message (claim.maybeCharged) says the payment may already have been taken and links to /trips. Returning 200/202 to the same buyer on the server side needs backend/API change. — dosyalar: `src/components/transfers/ClaimForm.tsx`

## F308 — E-posta doğrulama şartı önceden bildirilmiyor; hata çıkışsız kalıyor

| Alan                | Değer                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                              |
| Durum               | Aday                                                                                                              |
| Konum               | `src/components/transfers/ClaimForm.tsx:74`                                                                       |
| Diğer konumlar      | `src/components/transfers/TransferMarket.tsx:132`, `src/app/api/user/me/route.ts:15`, `src/lib/http/errors.ts:42` |
| Kullanıcılar        | misafir                                                                                                           |
| Prensip             | robustness · recoverability                                                                                       |
| Sezgisel madde      | H9 — Hata mesajları                                                                                               |
| Renk/tema           | Hayır                                                                                                             |
| Efor                | M                                                                                                                 |
| Kaynak denetçiler   | area:misc                                                                                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: misc)                                                                               |

**Kanıt:** api/transfers/route.ts:16 ve api/transfers/claim/route.ts:17 `requireVerifiedEmail(req)` çağırıyor. Hata metni errors.ts:42 'Bu işlem için e-posta adresinizi doğrulamanız gerekiyor' ve ClaimForm.tsx:74 ile TransferMarket.tsx:132 `errorMessage(err)` ile olduğu gibi basılıyor. /api/user/me (user/me/route.ts:15-23) emailVerifiedAt döndürmüyor, bu yüzden UI önceden kontrol edemiyor. /api/auth/verify-email/resend ucunu çağıran bir UI yok.

**Etki:** Doğrulanmamış alıcı kart bilgilerinin tamamını girdikten sonra hatayla karşılaşıyor. Satıcı da fiyat girip 'Devret'e bastıktan sonra öğreniyor. Mesajda doğrulama e-postasını yeniden gönderme yolu gösterilmiyor, kullanıcı çıkmaza giriyor.

**Önerilen aksiyon:** /api/user/me yanıtına `emailVerified: boolean` ekleyin. ClaimForm ve SellPanel formdan önce doğrulanmamış kullanıcıya bir uyarı kutusu göstersin: 'Devir için e-postanızı doğrulayın' metni, 'Doğrulama e-postasını yeniden gönder' düğmesi (POST /api/auth/verify-email/resend, sonuç aria-live ile duyurulsun) ve demo modunda /dev/mailbox bağlantısı. API hatasında `err.code === 'EMAIL_NOT_VERIFIED'` gelirse aynı kutu gösterilsin.

**Yapılan düzeltme:** ClaimForm.tsx: added an exported VerifyEmailNotice component (explanation, a 'Doğrulama e-postasını yeniden gönder' button calling POST /api/auth/verify-email/resend, result announced with aria-live, aria-busy). Both ClaimForm and SellPanel show it when the API returns err.code === 'EMAIL_NOT_VERIFIED'. Warning the user before they fill the form needs emailVerified in /api/user/me (needs backend/API change). — dosyalar: `src/components/transfers/ClaimForm.tsx`, `src/components/transfers/TransferMarket.tsx`

## F309 — Satıcı açtığı ilanı göremiyor ve geri çekemiyor (API var, UI yok)

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | High                                                                         |
| Durum               | Aday                                                                         |
| Konum               | `src/components/transfers/TransferMarket.tsx:86`                             |
| Diğer konumlar      | `src/app/api/transfers/route.ts:26`, `src/app/api/transfers/[id]/route.ts:7` |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | robustness · recoverability (user control)                                   |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                            |
| Renk/tema           | Hayır                                                                        |
| Efor                | M                                                                            |
| Kaynak denetçiler   | area:misc                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                                 |

**Kanıt:** TransferMarket.tsx:86-98 yalnızca keşif listesini ve SellPanel'i render ediyor. İlanlarım listesi ve iptal eylemi yok. Buna karşın API'de GET /api/transfers (route.ts:26-33) ve DELETE /api/transfers/[id] (cancelTransferListing, [id]/route.ts:7-16) mevcut. Bağlantı ömrü TRANSFER_LINK_TTL_HOURS=168 saat (app-config.ts:171).

**Etki:** Seyahate yine gitmeye karar veren satıcı ilanı 7 güne kadar geri çekemiyor. Bağlantıyı alan biri ödeme yaptığında rezervasyon geri alınamaz biçimde el değiştiriyor.

**Önerilen aksiyon:** 'İlanlarım' adlı bir Card ekleyin: rezervasyon, istenen fiyat, durum (LISTED/COMPLETED/CANCELLED için i18n etiketleri) ve geçerlilik tarihi gösterilsin. Her LISTED satıra variant='danger' bir 'İlanı geri çek' düğmesi koyun. Düğme onay diyaloğu açsın ('Bağlantı hemen geçersiz olur'), sonra DELETE /api/transfers/{id} çağırsın ve sonucu Status ile duyursun.

**Yapılan düzeltme:** TransferMarket.tsx: added a 'Devir ilanlarım' card loaded from GET /api/transfers and filtered to sellerId === session.user.id. It shows the property name (matched from /api/bookings), dates, price, status label (mine.status.*, including EXPIRED and OTHER) and expiry date. Active listings get a variant='danger' 'İlanı geri çek' button: confirm dialog, then DELETE /api/transfers/{id}, result announced with Status, and the list reloads. — dosyalar: `src/components/transfers/TransferMarket.tsx`

## F310 — Devir ilanı formunda çift gönderim koruması yok; gösterilen bağlantı iptal edilmiş olabilir

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | High                                              |
| Durum               | Aday                                              |
| Konum               | `src/components/transfers/TransferMarket.tsx:116` |
| Diğer konumlar      | `src/lib/transfer/transfer-service.ts:170`        |
| Kullanıcılar        | misafir                                           |
| Prensip             | robustness · responsiveness / error prevention    |
| Sezgisel madde      | H5 — Hata önleme                                  |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:misc                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                      |

**Kanıt:** TransferMarket.tsx:116-134 submit fonksiyonunda busy durumu yok. 183 `<Button type="submit" className="w-full">` disabled almıyor ve metni değişmiyor. Sunucu her yeni ilanda öncekini iptal ediyor: transfer-service.ts:170-173 `updateMany({ where: { bookingId, status: LISTED }, data: { status: CANCELLED } })`. 127 `setClaimUrl(res.claimUrl)` hangi yanıt son gelirse onu yazıyor.

**Etki:** Yavaş ağda iki kez tıklayan veya Enter'a iki kez basan satıcı için iki ilan açılıyor ve ilki iptal ediliyor. Yanıtlar ters sırada gelirse ekranda iptal edilmiş bağlantı kalıyor. Satıcı bu bağlantıyı paylaşıyor, alıcı 'Devir linki geçersiz' hatası alıyor ve iki taraf da nedenini anlayamıyor.

**Önerilen aksiyon:** SellPanel'e `const [busy, setBusy] = useState(false)` ekleyin. submit başında `if (busy) return; setBusy(true)`, finally bloğunda `setBusy(false)` olsun. Düğmeye `disabled={busy}` verin, busy iken metin t('sell.submitting') ('Oluşturuluyor…') olsun. Forma `aria-busy={busy}` ekleyin.

**Yapılan düzeltme:** SellPanel: added busy state with an early return, disabled={busy}, aria-busy on the form, and the button reads sell.submitting while busy. The amount is parsed with parseAmountToMinor using the currency's fraction digits. The restrictive pattern was removed, the hint now shows an example format, and an invalid amount shows a Field error and moves focus to the field. — dosyalar: `src/components/transfers/TransferMarket.tsx`

## F311 — Aynı rezervasyonu yeniden ilana çıkarmak paylaşılmış bağlantıyı uyarısız geçersiz kılıyor

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | High                                                                            |
| Durum               | Aday                                                                            |
| Konum               | `src/components/transfers/TransferMarket.tsx:151`                               |
| Diğer konumlar      | `src/lib/transfer/transfer-service.ts:170`, `src/app/api/transfers/route.ts:26` |
| Kullanıcılar        | misafir                                                                         |
| Prensip             | learnability · predictability                                                   |
| Sezgisel madde      | H13 — Feedforward                                                               |
| Renk/tema           | Hayır                                                                           |
| Efor                | M                                                                               |
| Kaynak denetçiler   | area:misc                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                                    |

**Kanıt:** TransferMarket.tsx:151-187 form başarıdan sonra da açık kalıyor. Seçim listesi (159-164) rezervasyonun zaten ilanda olup olmadığını göstermiyor. Sunucu transfer-service.ts:170-173 eski LISTED kaydı CANCELLED yapıyor. GET /api/transfers (listMyTransfers, route.ts:26-33) mevcut ama UI çağırmıyor.

**Etki:** Bağlantıyı alıcıyla paylaşmış satıcı sayfaya dönüp fiyatı düşürmek için formu yeniden gönderirse eski bağlantı sessizce ölüyor. Alıcı ödeme ekranında hata alıyor, satıcı bunun nedenini bilmiyor.

**Önerilen aksiyon:** SellPanel /api/transfers verisini yüklesin. İlanda olan rezervasyonların seçeneğine '(ilanda, {f.date(expiresAt)} tarihine kadar)' eklensin. Böyle bir rezervasyon seçiliyken düğme metni 'Yeni bağlantı oluştur' olsun. Gönderimden önce onay diyaloğu açılsın: 'Önceki bağlantı geçersiz olur; alıcıya yeni bağlantıyı iletmeniz gerekir.'

**Yapılan düzeltme:** SellPanel: a booking that is already listed shows '(ilanda, {date} tarihine kadar)' in its option text. When it is selected, the button reads 'Yeni bağlantı oluştur', and a danger confirm dialog explaining the old link will stop working runs before submit. — dosyalar: `src/components/transfers/TransferMarket.tsx`

## F312 — 'Gizle' bir kez gösterilen devir bağlantısını onaysız ve geri dönüşsüz siliyor

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | High                                                             |
| Durum               | Aday                                                             |
| Konum               | `src/components/transfers/TransferMarket.tsx:209`                |
| Diğer konumlar      | `messages/tr/transfers.json:27`, `messages/en/transfers.json:27` |
| Kullanıcılar        | misafir                                                          |
| Prensip             | robustness · recoverability                                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | area:misc                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                     |

**Kanıt:** TransferMarket.tsx:209 `<Button variant="secondary" onClick={() => setClaimUrl(null)}>{t("sell.hide")}</Button>`. 194'teki uyarı (tr/transfers.json:24) 'Devir bağlantısı yalnızca şimdi gösterilir' diyor. Sunucu token'ı bir daha üretmiyor (transfer-service.ts:114 yorumu). Sayfadan ayrılma veya yenileme için beforeunload uyarısı da yok.

**Etki:** Kopyalamadan 'Gizle'ye basan ya da sayfayı yenileyen satıcı bağlantıyı kalıcı olarak kaybediyor. Tek çıkış yolu yeniden ilan açmak, bu da 6. bulgudaki uyarısız geçersiz kılmayı tetikliyor. Düğme metni eylemin geri alınamaz olduğunu belli etmiyor.

**Önerilen aksiyon:** Düğmeyi 'Kopyaladım, kapat' olarak yeniden adlandırın. copied=false iken basılırsa onay diyaloğu açılsın: 'Bağlantı bir daha gösterilmeyecek; kopyalamadan kapatmak istiyor musunuz?'. claimUrl varken ve kopyalanmamışken `beforeunload` uyarısı ekleyin. Uyarı metnine 'Kaybederseniz yeni bağlantı oluşturabilirsiniz; eskisi geçersiz olur' cümlesini ekleyin.

**Yapılan düzeltme:** The 'Gizle' button is now 'Kopyaladım, kapat' (same sell.hide key, new value). If the link has not been copied, a danger confirm dialog runs first. A beforeunload warning is active while the link is shown and not yet copied. Added a sell.linkLost sentence saying a lost link can be replaced with a new one. — dosyalar: `src/components/transfers/TransferMarket.tsx`

## F313 — Tek seferlik devir bağlantısı 'Gizle' ile onaysız ve geri dönüşsüz kayboluyor; kendi devir ilanlarını yönetme ekranı yok

| Alan                | Değer                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                 |
| Durum               | Aday                                                                                                 |
| Konum               | `src/components/transfers/TransferMarket.tsx:209`                                                    |
| Diğer konumlar      | `src/components/transfers/TransferMarket.tsx:194`, `src/components/transfers/TransferMarket.tsx:184` |
| Kullanıcılar        | misafir                                                                                              |
| Prensip             | robustness · recoverability                                                                          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                    |
| Renk/tema           | Hayır                                                                                                |
| Efor                | M                                                                                                    |
| Kaynak denetçiler   | lens:status                                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: misc)                                                                         |

**Kanıt:** TransferMarket.tsx:194 `{t("sell.linkOnce")}` = 'Devir bağlantısı yalnızca şimdi gösterilir — kopyalayıp alıcıyla paylaşın.'; 209 `<Button variant="secondary" onClick={() => setClaimUrl(null)}>` ('Gizle') onaysız. Sayfada satıcının açık devir ilanlarını listeleyen/geri çeken bölüm yok; 182-185 'Devret' butonunda busy durumu da yok.

**Etki:** Satıcı misafir kopyalamadan 'Gizle'ye basarsa ilan açık kalıyor ama paylaşılabilir bağlantı kalıcı olarak kayboluyor; ilanı geri çekme ya da yeni bağlantı alma yolu yok (rezervasyon ücretinin geri kazanılması engelleniyor).

**Önerilen aksiyon:** 'Gizle'yi kopyalanana kadar devre dışı bırak veya onay iste ('Bağlantı bir daha gösterilmeyecek. Kopyaladınız mı?'); sunucuya 'bağlantıyı yeniden üret' uç noktası ekleyip 'Devir ilanlarım' listesinde 'Yeni bağlantı oluştur' ve 'İlanı geri çek' eylemleri; 'Devret' butonuna busy/disabled.

**Yapılan düzeltme:** Duplicate of F312, F309 and F310: close confirmation, 'Devir ilanlarım' with withdraw, a way to create a new link (the replace flow from F311), and the busy state on 'Devret'. — dosyalar: `src/components/transfers/TransferMarket.tsx`

## F884 — Şehirler serbest metin; desteklenen şehirler önerilmiyor, EN adlar eşleşmiyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/components/plan/TripPlanner.tsx:48`          |
| Diğer konumlar      | `src/lib/ai/trip-planner.ts:56`                   |
| Kullanıcılar        | misafir                                           |
| Prensip             | learnability · recognition > recall / familiarity |
| Sezgisel madde      | H6 — Tanıma > hatırlama                           |
| Renk/tema           | Hayır                                             |
| Efor                | M                                                 |
| Kaynak denetçiler   | area:misc                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p095)            |

**Kanıt:** TripPlanner.tsx:48 `useState("İstanbul, Kapadokya, Antalya")` i18n dışında, sabit kodlu ve placeholder değil değer olarak dolu. 116-124 düz <input>: datalist veya öneri yok. trip-planner.ts:56-66 Location.city ile birebir eşleştiriyor, eşleşmezse 'Şehir bulunamadı: {n}' hatası veriyor.

**Etki:** EN kullanıcısı 'Cappadocia' yazınca hata alıyor. Kullanıcı hangi şehirlerin desteklendiğini ezberlemek ya da deneme yanılmayla bulmak zorunda. Önceden dolu değer kullanıcının kendi listesini yazmadan önce silinmesi gereken bir engel.

**Önerilen aksiyon:** Desteklenen şehir listesini (Location) döndüren bir uç ekleyin ve virgülle ayrılmış metin yerine çoklu seçimli bir combobox (chip) kullanın. En azından input'a `list="trip-city-options"` ile bir <datalist> bağlayın. Varsayılan değeri kaldırıp örneği placeholder olarak plan.json'a taşıyın ('Örn. İstanbul, Kapadokya').

**Yapılan düzeltme:** Confirmed. The cities field now starts empty, and the visible hint still shows the example (no prefilled value). Under the input there is a 'Desteklenen şehirler' group of toggle chips (aria-pressed, ✓ icon), loaded from the existing GET /api/locations. Picking a chip adds or removes that DB city name, and adding stops at 6 cities. The server still needs to accept EN aliases such as 'Cappadocia'; that is in crossOwner.

## F885 — 'Tut' plan anındaki misafir sayısını değil formdaki güncel değeri kullanıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/plan/TripPlanner.tsx:100`      |
| Diğer konumlar      | `src/lib/booking-service.ts:298`               |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · predictability / error prevention |
| Sezgisel madde      | H5 — Hata önleme                               |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:misc                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)                |

**Kanıt:** TripPlanner.tsx:100 `guestCount: Number(guests)` canlı form state'inden okunuyor. Form plan oluştuktan sonra da düzenlenebiliyor. Teklif misafir sayısına bağlı: booking-service.ts:298 `quote.guests !== input.guestCount` → 'Teklif bu rezervasyon bilgileriyle eşleşmiyor'.

**Etki:** Planı gördükten sonra misafir sayısını 3'e çevirip 'Tut'a basan kullanıcı anlamadığı bir hata alıyor. Ekranda eski parametrelerle oluşturulmuş plan güncelmiş gibi duruyor.

**Önerilen aksiyon:** Plan oluşturulduğunda istek parametrelerini (`planRequest`) plan ile birlikte saklayın ve hold'da `planRequest.guests` kullanın. Form değerleri planRequest'ten farklıysa sonuç kartının üstünde 'Bilgileri değiştirdiniz; planı güncelleyin' uyarısı gösterin ve 'Tut' düğmelerini devre dışı bırakın.

**Yapılan düzeltme:** Confirmed. The request that produced the plan is now stored with it as `request` and persisted in sessionStorage. Older saved states fall back to the saved form values. Hold now sends `request.guests`. If the form no longer matches that request, the result card shows a 'stale' notice and the hold buttons become aria-disabled with aria-describedby pointing to the notice; hold() also returns early.

## F886 — 'Toplam gün' alanı aslında gece sayısı olarak işleniyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Medium                                                      |
| Durum               | Aday                                                        |
| Konum               | `src/components/plan/TripPlanner.tsx:126`                   |
| Diğer konumlar      | `messages/tr/plan.json:7`, `src/lib/ai/trip-planner.ts:120` |
| Kullanıcılar        | misafir                                                     |
| Prensip             | learnability · familiarity (gerçek dünya eşleşmesi)         |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                 |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | area:misc                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)                             |

**Kanıt:** TripPlanner.tsx:126 etiket `t("form.days")` = 'Toplam gün' (tr/plan.json:7). trip-planner.ts:120-126 `days` değerini duraklara gece olarak dağıtıyor (`nights = base + …`). docs/img/trip-planner.png'de 6 gün girişi '6 gecelik rota' olarak dönüyor. Formda bitiş tarihi önizlemesi yok.

**Etki:** '6 günlük gezi' (5 gece) planlayan misafire 6 gece konaklama ve bir gece fazla ücret öneriliyor. Para ve tarih hatasına toleransı düşük kullanıcı bunu ancak duraklardaki tarihleri dikkatle okursa fark ediyor.

**Önerilen aksiyon:** Etiketi 'Toplam gece' / 'Total nights' yapın. Ya da gün olarak tutup sunucuya `days - 1` gece gönderin. Alanın altına canlı bir önizleme ekleyin: 'Dönüş (son çıkış): {f.date(startDate + nights)}'.

**Yapılan düzeltme:** Confirmed. The label is now 'Toplam gece' / 'Total nights', and errors.invalid.days talks about nights. The field hint shows the per-city minimum and a live final check-out date (start date, or today+14 when empty, plus nights), formatted with f.date.

## F887 — Planlayıcı formunda istemci kısıtları ve isteğe bağlılık bilgisi eksik

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/plan/TripPlanner.tsx:150` |
| Diğer konumlar      | `src/lib/ai/trip-planner.ts:114`          |
| Kullanıcılar        | misafir                                   |
| Prensip             | robustness · error prevention             |
| Sezgisel madde      | H5 — Hata önleme                          |
| WCAG                | 3.3.2                                     |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:misc                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)           |

**Kanıt:** TripPlanner.tsx:150-158 tarih alanında `min` yok, geçmiş tarih seçilebiliyor. Alan zorunlu değil ama isteğe bağlı olduğu belirtilmiyor; boş bırakılırsa sunucu 14 gün sonrasını kullanıyor (trip-planner.ts:117). 126-137 `min={1}` ile gün sayısı şehir sayısından az girilebiliyor, sunucu bunu reddediyor (trip-planner.ts:114-115).

**Etki:** Geçmiş bir tarih seçen misafir 'uygun konaklama bulunamadı' sonuçları alıyor ve nedenini anlamıyor. Tarihi boş bırakan kullanıcı planın neden iki hafta sonrasına kurulduğunu bilmiyor.

**Önerilen aksiyon:** Tarih alanına `min={isoDay(0)}` verin. Etikete '(isteğe bağlı; boşsa 14 gün sonrası)' ekleyin. Gün alanında `min={Math.max(1, cityCount)}` kullanın ve ipucu ekleyin: 'Her şehir için en az 1 gece'.

**Yapılan düzeltme:** Confirmed. The date input has min={isoDay(0)}, its label says '(isteğe bağlı)' and its hint states the default date (today+14, formatted). The nights input uses min=max(1, city count) and its hint says 'Her şehir için en az 1 gece: {min}–30 gece.'

## F888 — 'Tut' hatası tıklanan durağın yanında değil, sayfanın üstünde gösteriliyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/plan/TripPlanner.tsx:167` |
| Kullanıcılar        | misafir                                   |
| Prensip             | robustness · observability                |
| Sezgisel madde      | H12 — Feedback                            |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:misc                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)           |

**Kanıt:** TripPlanner.tsx:105-107 hold hatası `setError(...)` ile tek ortak Status'e yazılıyor. Bu Status 167'de, sonuç kartının ÜSTÜNDE duruyor. Hatadan sonra düğme sessizce 'Tut (hold)' metnine dönüyor (setHolding(null)).

**Etki:** Mobilde 3. veya 4. durağı tutmaya çalışan misafir hatayı (ör. 'Fiyat teklifinin süresi doldu') görmüyor; hata ekranın dışında kalıyor. Kullanıcı düğmeye tekrar tekrar basıyor.

**Önerilen aksiyon:** Durak başına hata state'i tutun (`holdErrors[index]`) ve hatayı ilgili li içinde, düğmenin hemen altında `<p role="alert">` ile gösterin. Ortak Status yalnızca plan oluşturma hataları için kalsın.

**Yapılan düzeltme:** Confirmed. Hold errors are now kept per stop (holdErrors[index]) and shown inside that stop's li, right under the button, as <p role="alert"> with an icon and a sr-only prefix. The shared Status is only used for plan-creation errors. The busy hold button now uses Button busy instead of disabled, so it keeps focus.

## F889 — Plan sonucu tümüyle canlı bölgede duyuruluyor, odak sonuca taşınmıyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Aday                                               |
| Konum               | `src/components/plan/TripPlanner.tsx:169`          |
| Kullanıcılar        | misafir                                            |
| Prensip             | accessibility · WCAG 4.1.3 Durum Mesajları / 2.4.3 |
| Sezgisel madde      | H12 — Feedback                                     |
| WCAG                | 4.1.3                                              |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | area:misc                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)                    |

**Kanıt:** TripPlanner.tsx:169 `<div aria-live="polite">` tüm sonuç Card'ını (rota, anlatım, duraklar, toplam) sarıyor. Gönderimden sonra odak gönder düğmesinde (160) kalıyor; sonuç başlığına (171 'trip-result') odak veya kaydırma yapılmıyor.

**Etki:** Ekran okuyucu planın tamamını kesintisiz okuyor; kullanıcı durduramıyor ve gezinemiyor. Mobilde (360px) sonuç formun altında, ekran dışında kalıyor ve kullanıcı bir şey olmadığını sanabiliyor.

**Önerilen aksiyon:** Sarmalayıcıdaki aria-live'ı kaldırın. Status'e kısa bir sr-only özet yazın: 'Plan hazır: {n} durak, toplam {amount}'. Sonuç h2'sine `tabIndex={-1}` verip plan geldiğinde ona focus() yapın; tarayıcı odaklanan öğeyi görünür alana kaydırır.

**Yapılan düzeltme:** Confirmed. I removed the aria-live wrapper around the result card. Status now shows a short message: 'Plan hazır: {n} durak, konaklama toplamı {amount}', with a fallback when no stay was found. After a plan is created, focus moves to the result h2 (tabIndex -1 is set and the browser scrolls it into view). The submit button uses busy, so focus is not lost while the request runs.

## F890 — Plan anlatımı listeyi tekrarlıyor, EN'de Türkçe kalıyor, tarih biçimi tutarsız

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/components/plan/TripPlanner.tsx:182`    |
| Diğer konumlar      | `src/lib/ai/trip-planner.ts:144`             |
| Kullanıcılar        | misafir                                      |
| Prensip             | learnability · consistency / minimal tasarım |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                 |
| WCAG                | 3.1.2                                        |
| Renk/tema           | Hayır                                        |
| Efor                | M                                            |
| Kaynak denetçiler   | area:misc                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p095)       |

**Kanıt:** TripPlanner.tsx:182 `<p …>{plan.narrative}</p>`. 67-75 istek gövdesinde `locale` gönderilmiyor. trip-planner.ts:144-154 demo anlatımı sabit Türkçe ve ISO tarih kullanıyor ('2026-10-13 – 2026-10-15 (2 gece)'). Hemen altındaki liste ise '13.10.2026' biçiminde (docs/img/trip-planner.png).

**Etki:** Kullanıcı aynı bilgiyi iki kez ve iki farklı tarih biçimiyle okuyor; ekran okuyucuda bu tekrar daha da uzuyor. EN arayüzde blok Türkçe kalıyor ve lang işareti olmadığı için yanlış telaffuzla okunuyor.

**Önerilen aksiyon:** İsteğe `locale` ekleyip anlatımı o dilde üretin. Tarihleri biçimlendiriciden geçirin. Anlatımı `<details><summary>Yapay zekâ özeti</summary>…</details>` içine alın ya da yalnızca listede olmayan bilgiyi (rota gerekçesi) gösterin.

**Yapılan düzeltme:** Confirmed. The narrative now sits in a collapsed <details> with the summary 'Yapay zekâ özeti', keeps its line breaks, and has lang={plan.narrativeLocale ?? "tr"} so it is pronounced correctly. The request body now sends `locale` (the route's zod object strips unknown keys, so this is safe). Writing the narrative in that locale with formatted dates has to happen on the server (crossOwner).

## F891 — 'Tut (hold)' etiketi dil karışık, süresi belirsiz; meşgulken erişilebilir ad görünen metinle uyuşmuyor

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Aday                                                   |
| Konum               | `src/components/plan/TripPlanner.tsx:198`              |
| Diğer konumlar      | `messages/tr/plan.json:17`, `messages/tr/plan.json:22` |
| Kullanıcılar        | misafir                                                |
| Prensip             | accessibility · WCAG 2.5.3 Addaki Etiket; familiarity  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                            |
| WCAG                | 2.5.3                                                  |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:misc                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p095)                 |

**Kanıt:** TripPlanner.tsx:198 `aria-label={t("result.holdLabel", { city: s.city })}` sabit kalıyor ('{city} konaklamasını tut (hold)'). 200'de görünen metin `holding === i ? t("result.holding") : …` ile 'Tutuluyor…' oluyor. tr/plan.json:17 'Tut (hold)' Türkçe ile İngilizceyi karıştırıyor. 22. satırdaki not ise «Tut» yazıyor ve süreyi 'kısa süre' diye belirtiyor; gerçek süre BOOKING_HOLD_TTL_MINUTES=15 (app-config.ts:53).

**Etki:** İstek sürerken ekran okuyucu düğmeyi hâlâ 'tut' olarak okuyor, işlem durumunu duyurmuyor; sesli komut kullanıcısı görünen 'Tutuluyor' metniyle düğmeyi bulamıyor. Misafir 'hold' kelimesini ve odanın ne kadar süre ayrılacağını anlamıyor.

**Önerilen aksiyon:** Düğme metnini 'Odayı 15 dk ayır' / 'Hold room for 15 min' yapın; süre yapılandırmadan gelsin. Meşgul durumda aria-label'ı `t('result.holdingLabel', {city})` ('{city} konaklaması ayrılıyor…') yapın ve düğmeye `aria-busy` ekleyin. Not metnini aynı terimle ve süreyle yeniden yazın.

**Yapılan düzeltme:** Confirmed. The button now says 'Odayı ayır' / 'Hold room'; while busy it says 'Ayrılıyor…'. Its accessible name starts with the visible text ('Odayı ayır: {city}' / 'Ayrılıyor: {city}'), and Button busy adds aria-busy. The note uses the same term and states the minutes when the server sends holdMinutes. After a hold, the stop shows the real deadline from booking.holdExpiresAt ('Ayrıldı; ödeme için son saat {time}'). Showing the duration before a hold needs holdMinutes from the server (crossOwner).

## F892 — Konaklama toplamı eksik durakları ve farklı para birimlerini sessizce dışarıda bırakıyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/plan/TripPlanner.tsx:209` |
| Diğer konumlar      | `src/lib/ai/trip-planner.ts:136`          |
| Kullanıcılar        | misafir                                   |
| Prensip             | robustness · observability                |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü            |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:misc                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)           |

**Kanıt:** TripPlanner.tsx:209-214 `t.rich("result.total", { amount: f.money(plan.total, plan.currency) })` 'Konaklama toplamı' metniyle gösteriliyor. trip-planner.ts:136-140 toplamı yalnızca konaklaması bulunan ve ilk para birimindeki duraklardan hesaplıyor (`.filter((s) => s.stay!.currency === currency)`).

**Etki:** Bir durakta konaklama bulunamadığında ya da farklı para birimi olduğunda misafir toplamı gezinin tam maliyeti sanıyor. Bütçe kararı eksik bilgiyle veriliyor.

**Önerilen aksiyon:** Konaklamasız durak varsa metni 'Konaklama toplamı ({n}/{m} durak): {amount}' yapın ve altına 'Konaklama bulunamayan: {şehirler}' ekleyin. Birden çok para birimi varsa her biri için ayrı toplam gösterin (API `totals: [{currency, total}]` dönsün).

**Yapılan düzeltme:** Confirmed. The total is now computed on the client from the stops, per currency (for example '₺X + €Y'), instead of using plan.total. When some stops have no stay, it reads 'Konaklama toplamı ({priced}/{count} durak)' and a line below lists those cities ('Konaklama bulunamayan: {cities}').

## F893 — Fiyat teklifinin 15 dakikalık süresi görünmüyor; süre dolunca yenileme eylemi yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/plan/TripPlanner.tsx:215`   |
| Diğer konumlar      | `src/lib/booking-service.ts:288`            |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · observability / recoverability |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:misc                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p095)      |

**Kanıt:** QUOTE_TTL_MINUTES=15 (app-config.ts:55). Süre dolduktan sonra 'Tut' booking-service.ts:288-290 'Fiyat teklifinin süresi doldu, lütfen yenileyin' (QUOTE_EXPIRED) hatası veriyor. TripPlanner.tsx:215 not metninde geçerlilik süresi yok. Sonuç kartında 'Fiyatları yenile' eylemi yok.

**Etki:** Planı inceleyip 15 dakika sonra 'Tut'a basan misafir 'yenileyin' mesajını alıyor ama yenileme düğmesi bulamıyor. Formu yeniden gönderince farklı konaklamalar gelebiliyor.

**Önerilen aksiyon:** API'den teklif bitiş zamanını (`quoteExpiresAt`) dönün ve sonuçta 'Fiyatlar {f.time(...)} saatine kadar geçerli' yazın. QUOTE_EXPIRED gelirse ilgili durakta 'Fiyatları yenile' düğmesi gösterin; düğme saklanan planRequest ile planı yeniden istesin.

**Yapılan düzeltme:** Confirmed. When a hold fails with QUOTE_EXPIRED (or 409), the stop shows a 'Fiyatları yenile' button. It requests the plan again with the stored request. Stops already held keep their stay and idempotency key; other stops get new quotes and keys. Focus then goes back to that stop's button and Status says 'Fiyatlar yenilendi'. The 'Fiyatlar şu saate kadar geçerli: {time}' line only appears once the server returns quoteExpiresAt (crossOwner).

## F894 — Destek konuşması ve talep numarası kalıcı değil; kullanıcı talebini takip edemiyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/components/support/SupportChat.tsx:37`       |
| Diğer konumlar      | `messages/tr/support.json:18`                     |
| Kullanıcılar        | misafir                                           |
| Prensip             | flexibility · task migratability / recoverability |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                 |
| Renk/tema           | Hayır                                             |
| Efor                | M                                                 |
| Kaynak denetçiler   | area:misc                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p118)                   |

**Kanıt:** SupportChat.tsx:37 `useState<Turn[]>([])`. ticketId yalnızca state'te tutuluyor (62, 110-114). 79'daki `handedOff` turns'ten türetiliyor ve sayfa yenilenince sıfırlanıyor. Kullanıcıya ait bir talep ucu yok; yalnızca /api/admin/support var. humanPending (tr/support.json:18) 'bir temsilci size dönecek' diyor ama kanal ve süre belirtmiyor.

**Etki:** İnsana devredilen misafir sayfayı yenileyince talep numarasını ve konuşmayı kaybediyor. 'İnsana bağlan' yeniden etkinleştiği için aynı konu için ikinci bir talep açabiliyor. Dönüşün e-postayla mı yoksa uygulama içinden mi geleceğini bilmiyor.

**Önerilen aksiyon:** turns'ü kullanıcı kimliğiyle anahtarlanan sessionStorage'da saklayın (try/catch içinde). GET /api/support/tickets (kendi talepleri) ucunu ekleyin ve açık talep varsa sohbetin üstünde 'Açık talebiniz #{kısa id}: {durum}' satırı gösterin; bu durumda 'İnsana bağlan'ı devre dışı bırakın. humanPending metnine gerçek kanalı yazın (ör. 'Yanıt {email} adresine e-postayla gelecek').

**Yapılan düzeltme:** Confirmed: turns and ticketId were kept only in memory, so a refresh re-enabled 'İnsana bağlan'. Turns are now saved in sessionStorage under the key support-chat:<userId> (try/catch), restored once the session is known, and 'İnsana bağlan' stays disabled after a refresh. A new GET /api/support/tickets route returns the user's own last 5 tickets, shown above the chat as 'Destek talepleriniz' (date, full id, status label). humanPending now names the channel (account e-mail) and points to that list. I did not disable the button for any server-side open ticket, because a guest may have a second, unrelated issue and a stale DB would block the e2e test on re-runs. A 'Yeni konuşma başlat' button clears the saved conversation.

## F895 — Destek sohbeti sayfadan çıkınca kayboluyor; insana devredilen talebi izleyecek yer yok

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/components/support/SupportChat.tsx:37`       |
| Diğer konumlar      | `src/components/support/SupportChat.tsx:112`      |
| Kullanıcılar        | misafir                                           |
| Prensip             | flexibility · multithreading / task migratability |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                    |
| Renk/tema           | Hayır                                             |
| Efor                | M                                                 |
| Kaynak denetçiler   | lens:nav                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p118)            |

**Kanıt:** 37 `const [turns, setTurns] = useState<Turn[]>([])` yalnız bellekte. Devirde 112 `t("handoff", { id: turn.ticketId })` "Konu insan destek ekibine devredildi (talep: {id})" ve 148 humanPending gösteriliyor. Kullanıcının taleplerini listeleyen bir sayfa ya da API yok; destek altında yalnız src/app/api/support/chat/route.ts var.

**Etki:** Misafir bir talep numarası alıyor ama durumunu kontrol edebileceği ya da yanıtı okuyabileceği bir yer yok. Sayfadan çıkınca konuşma da siliniyor.

**Önerilen aksiyon:** Konuşmayı sunucuda bir thread olarak ya da sessionStorage'da saklayın. /support altında durum ve son yanıtla "Destek taleplerim" listesi ekleyin. Yönetici yanıtında derin bağlantılı bildirim gönderin.

**Yapılan düzeltme:** Confirmed. The conversation now survives refresh and navigation (sessionStorage, per user), and /support lists the user's recent tickets with status via the new GET /api/support/tickets; the list reloads right after a handoff. A notification with a deep link when an admin changes the status belongs to the admin route and notifications module and is passed on as a crossOwner request.

## F896 — Başarısız gönderimde mesaj kayboluyor ve gönderilmiş gibi görünüyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/support/SupportChat.tsx:45` |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:misc                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p118)             |

**Kanıt:** SupportChat.tsx:45-46 istekten ÖNCE `setTurns(prev => [...prev, { role: "user", text }])` ve `setMessage("")` çalışıyor. 65-66 hata olursa yalnızca `setError(errorMessage(err))` çağrılıyor; turn başarısız diye işaretlenmiyor ve yeniden deneme eylemi yok.

**Etki:** Ağ hatası veya hız sınırı (429) durumunda misafirin uzun mesajı kutudan siliniyor, ama günlükte gönderilmiş gibi duruyor. Yeniden yazması gerekiyor. Hata kartın en altında göründüğü için hangi mesajın yanıtsız kaldığı belirsiz kalıyor.

**Önerilen aksiyon:** Turn'e `status: 'sending' | 'failed'` alanı ekleyin. Hata olursa ilgili balonun altında 'Gönderilemedi' metni ve 'Tekrar dene' düğmesi (onClick={() => ask(turn.text)}) gösterin. Alternatif olarak hata olursa `setMessage(text)` ile mesajı kutuya geri koyun ve balonu kaldırın.

**Yapılan düzeltme:** Confirmed. Turns now carry an id and status 'sending' \| 'failed'. On error the user bubble is marked failed and shows 'Gönderilemedi.' with a 'Tekrar dene' Button that resends the same text and keeps requestHuman; the stale failed copy is replaced. The Status error is still shown.

## F897 — Destek sohbeti: gönderilemeyen mesaj gönderilmiş gibi kalıyor, metin kutusu temizleniyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/support/SupportChat.tsx:45` |
| Diğer konumlar      | `src/components/support/SupportChat.tsx:65` |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H12 — Feedback                              |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | lens:status                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p118)             |

**Kanıt:** SupportChat.tsx:45 `setTurns((prev) => [...prev, { role: "user", text }])` ve 46 `setMessage("")` istekten önce (iyimser); 65-66 hata yalnız 150'deki `<Status error>`'a yazılıyor, kullanıcı balonu gönderilmiş görünümde kalıyor; tekrar gönderme yok. Bekleme sırasında log'da gösterge yok (yalnız buton 'Gönderiliyor…').

**Etki:** Misafir sorusunun iletildiğini sanıp yanıt bekliyor; tekrar denemek için metni yeniden yazması gerekiyor (mobilde maliyetli).

**Önerilen aksiyon:** Turn'e `status: 'sending' | 'failed'` ekle; hatada balonun altında 'Gönderilemedi — Tekrar dene' butonu ve metni input'a geri koy; beklerken log'a role=status 'Asistan yanıt hazırlıyor…'.

**Yapılan düzeltme:** Same fix as F896. On failure the text also goes back into the textarea when the box is empty, and a polite 'Asistan yanıt hazırlıyor…' line appears inside the role=log while waiting. Retry moves focus to the textarea so focus is not lost when the bubble's button disappears. As a side fix, 'İnsana bağlan' no longer wipes a typed draft.

## F898 — Destek sohbeti: gönderim başarısız olunca yazılan mesaj kayboluyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/support/SupportChat.tsx:46` |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H9 — Hata mesajları                         |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | lens:forms                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p118)             |

**Kanıt:** src/components/support/SupportChat.tsx:45-46 `setTurns((prev) => [...prev, { role: "user", text }]); setMessage("");` istekten ÖNCE; :65-66 `catch (err) { setError(errorMessage(err)); }` metni geri koymuyor, kullanıcı turu 'gönderildi' gibi kalıyor, yeniden dene düğmesi yok.

**Etki:** Uzun bir iade sorusunu yazan misafir ağ hatasında metnini kaybeder ve yeniden yazmak zorunda kalır; log'da yanıtsız mesaj yanıltıcıdır.

**Önerilen aksiyon:** Hata durumunda `setMessage(text)` ile metni geri yükle ve son kullanıcı turunu 'gönderilemedi' olarak işaretleyip yanına 'Tekrar gönder' düğmesi koy (ya da metni yalnız başarıdan sonra temizle).

**Yapılan düzeltme:** Covered by the F896/F897 change: on failure the text goes back into the empty textarea, the user bubble is marked 'Gönderilemedi.' with a 'Tekrar dene' button, and the draft is cleared only when it matches the sent text.

## F899 — Sohbet arayüzü bağlamı hatırlıyormuş gibi görünüyor, ama her mesaj tek başına işleniyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/support/SupportChat.tsx:51`      |
| Diğer konumlar      | `src/lib/support/agent.ts:292`                   |
| Kullanıcılar        | misafir                                          |
| Prensip             | learnability · predictability / synthesizability |
| Sezgisel madde      | H13 — Feedforward                                |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:misc                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p118)           |

**Kanıt:** SupportChat.tsx:50-54 gövdede yalnızca `message: text` var; önceki turlar gönderilmiyor. agent.ts:291-292 LLM'e yalnızca sistem istemi ve `<user_message>${input.message}</user_message>` gidiyor.

**Etki:** 'Check-in saati kaçta?' sorusunun ardından 'Peki çıkış?' diye soran misafir anlamsız ya da düşük güvenli bir yanıt alıyor ve konu gereksiz yere insan kuyruğuna düşüyor. Günlük görünümü, sistemin konuşmayı hatırladığı izlenimini veriyor.

**Önerilen aksiyon:** Son N (ör. 6) turu `history: [{role, text}]` olarak gönderin; supportChatSchema ve agent.ts tarafında bu alanı destekleyin. Bu yapılmayacaksa ipucu metnine 'Asistan her soruyu ayrı yanıtlar; sorunuzu tam yazın' ekleyin.

**Yapılan düzeltme:** Confirmed. supportChatSchema is .strict(), so the client cannot send history without a 400. I used the fallback from the finding: the hint (aria-describedby of the textarea) now starts with 'Asistan her mesajı ayrı yanıtlar, önceki mesajları hatırlamaz; sorunuzu tek mesajda tam yazın.' Real history support is a crossOwner request for api-schemas.ts and agent.ts.

## F900 — Sohbet günlüğü yeni mesaja kaymıyor ve klavyeyle kaydırılamıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/support/SupportChat.tsx:89`      |
| Kullanıcılar        | misafir                                          |
| Prensip             | accessibility · WCAG 2.1.1 Klavye; observability |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                   |
| WCAG                | 2.1.1                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:misc                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p118)                  |

**Kanıt:** SupportChat.tsx:89-94 `<div role="log" … className="mb-4 max-h-96 space-y-3 overflow-y-auto">` tanımında tabIndex, ref ve scrollIntoView/scrollTop güncellemesi yok. İçinde odaklanabilir öğe bulunmuyor.

**Etki:** Yaklaşık 4 turdan sonra yeni asistan yanıtı 384px'lik kutunun altında, görünmeyen alanda kalıyor ve kullanıcı yanıt gelmedi sanıyor. Safari'de yalnızca klavye kullananlar odaklanabilir öğesi olmayan kaydırma kutusunu kaydıramıyor.

**Önerilen aksiyon:** Log div'ine `tabIndex={0}` ve `ref={logRef}` ekleyin. `useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [turns])` ile her yeni turda en alta kaydırın (prefers-reduced-motion için smooth kullanmayın). Odak halkası için focusRing sınıfını uygulayın.

**Yapılan düzeltme:** Confirmed. The role=log div now has ref={logRef}, tabIndex={0}, rounded-md and the shared focusRing. An effect sets scrollTop = scrollHeight whenever turns or busy change; this is an instant jump with no smooth scroll, so it is safe with reduced motion.

## F901 — Destek sohbeti yeni yanıta kaymıyor ve bekleme göstergesi yok

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                    |
| Durum               | Aday                                                                                      |
| Konum               | `src/components/support/SupportChat.tsx:93`                                               |
| Diğer konumlar      | `src/components/support/SupportChat.tsx:96`, `src/components/support/SupportChat.tsx:136` |
| Kullanıcılar        | misafir, ev sahibi                                                                        |
| Prensip             | robustness · observability                                                                |
| Sezgisel madde      | H12 — Feedback                                                                            |
| Renk/tema           | Hayır                                                                                     |
| Efor                | S                                                                                         |
| Kaynak denetçiler   | lens:mobile                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p119)                                                           |

**Kanıt:** SupportChat.tsx:90-93 `role="log" … className="mb-4 max-h-96 space-y-3 overflow-y-auto"`, :96 `turns.map`. Yeni tur eklendiğinde kabı en alta kaydıran bir efekt yok. LLM yanıtı beklenirken günlükte ara durum gösterilmiyor; yalnız :136'daki düğme metni 'Gönderiliyor' oluyor.

**Etki:** Birkaç turdan sonra yeni yanıt 384px'lik kutunun altında kalıyor; telefonda klavye açıkken hiç görünmüyor. Yanıtın gelip gelmediği anlaşılmıyor ve kullanıcı mesajını tekrar gönderiyor.

**Önerilen aksiyon:** `turns` değiştiğinde `logRef.current.scrollTop = logRef.current.scrollHeight` uygula. busy durumunda günlüğe geçici bir 'Asistan yazıyor…' turu ekle (`aria-busy="true"`). Mobilde günlük yüksekliğini `max-h-[50dvh]` yap ve `overscroll-contain` ekle.

**Yapılan düzeltme:** The auto-scroll effect (on turns/busy) and the in-log 'thinking' indicator were already there from an earlier package. I added the missing mobile part: the log is now `max-h-[50dvh] overscroll-contain sm:max-h-96`, so on phones the log and the input fit in the viewport together. I left `aria-busy` off the log on purpose: a busy live region holds back its own announcements, which would hide the 'Asistan yanıt hazırlıyor…' indicator.

## F902 — Boş sohbette örnek soru yok (hatırlamaya dayalı başlangıç)

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/support/SupportChat.tsx:95` |
| Diğer konumlar      | `messages/tr/support.json:14`               |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · recognition > recall         |
| Sezgisel madde      | H6 — Tanıma > hatırlama                     |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:misc                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p119)             |

**Kanıt:** SupportChat.tsx:95 `{turns.length === 0 && <p …>{t("empty")}</p>}` yalnızca 'Henüz mesaj yok.' (tr/support.json:14) gösteriyor. Asistanın yanıtlayabildiği konular (agent.ts: booking_status, cancellation_quote, property_policy) tıklanabilir öneri olarak sunulmuyor.

**Etki:** Bilgisayar okuryazarlığı düşük misafir ne sorabileceğini bilmiyor ve serbest metinle desteklenmeyen sorular yazıyor. Bu sorular düşük güvenle insan kuyruğuna düşüyor.

**Önerilen aksiyon:** Boş durumda 3 öneri düğmesi gösterin: 'Rezervasyonumun durumu nedir?', 'Şimdi iptal edersem ne kadar iade alırım?', 'Giriş ve çıkış saatleri nedir?'. Her biri `onClick={() => ask(t('suggest.x'))}` çağırsın. Metinler support.json'a eklensin.

**Yapılan düzeltme:** An empty conversation now shows a labelled list of 3 suggestion buttons (booking status, refund if I cancel now, check-in/check-out times). Clicking one moves focus to the textarea and sends the question with ask(). I ran intent.ts's classifyIntent on each text in both locales: they map to booking_status, cancellation_quote and property_policy. New keys support.chat.suggestTitle and suggest.* are in the p119 patch.

## F903 — Destek sohbetinde örnek soru yok; insana devir sonrası kanal ve süre belirsiz

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/support/SupportChat.tsx:97`                  |
| Diğer konumlar      | `messages/tr/support.json:13`, `messages/tr/support.json:18` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · familiarity (tanıma > hatırlama)              |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                      |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | lens:copy                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p119)                       |

**Kanıt:** SupportChat.tsx:97 boş durumda yalnız support.json 'Henüz mesaj yok.'; sayfa girişi konuları sayar ama tıklanabilir öneri yok. 107-111 devir mesajı support.json:13 'Konu insan destek ekibine devredildi (talep: {id}).' ham ID; 18 'bir temsilci size dönecek' — e-postayla mı, ne zaman mı belirtilmez.

**Etki:** Misafir ne sorabileceğini tahmin etmek zorunda; devir sonrası yanıtı nerede bekleyeceğini bilmez, sayfayı kapatınca sohbet kaybolur.

**Önerilen aksiyon:** Boş durumda 3 öneri çipi ekleyin ('Rezervasyonumu iptal edersem ne kadar iade alırım?', 'Giriş saati kaçta?', 'Rezervasyonumu nasıl değiştiririm?'); devir metnini 'Talep no: {kısaKod}. Yanıt {email} adresine genellikle 24 saat içinde gönderilir.' yapın.

**Yapılan düzeltme:** The suggestion buttons are the same ones as F902. The handoff text is now 'Konu insan destek ekibine devredildi. Talep no: {id}.' with a clear ticket-number label. I kept the full ID because the ticket list and admin search use it. The reply channel is already covered by humanPending (updated by p118). I did not promise a response time such as '24 saat': the code has no support SLA or ticket e-mail, so that needs a product decision.

## F904 — Asistan yanıtı beklenirken günlükte durum göstergesi yok

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/components/support/SupportChat.tsx:135` |
| Kullanıcılar        | misafir                                      |
| Prensip             | robustness · responsiveness / observability  |
| Sezgisel madde      | H12 — Feedback                               |
| WCAG                | 4.1.3                                        |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:misc                                    |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p119)             |

**Kanıt:** SupportChat.tsx:135-137 bekleme durumu yalnızca düğme metninin 'Gönderiliyor…' olmasıyla belirtiliyor. role="log" (90) üzerinde `aria-busy` yok, günlükte 'Asistan yazıyor' öğesi yok. Düğme metnindeki değişiklik canlı bölge olmadığı için duyurulmuyor.

**Etki:** LLM birkaç saniye sürdüğünde ekran okuyucu kullanıcısı mesajının işlenip işlenmediğini bilmiyor. Görsel kullanıcı da yanıtın geleceği yerde (günlükte) hiçbir işaret görmüyor.

**Önerilen aksiyon:** busy iken günlüğün sonuna geçici bir asistan balonu ekleyin: `<p role="status">{t('typing')}</p>` ('Asistan yanıt hazırlıyor…'). Log div'ine `aria-busy={busy}` verin. Yanıt gelince geçici balonu kaldırın.

**Yapılan düzeltme:** Already handled in the current code. While busy, `<p>{t("thinking")}</p>` ('Asistan yanıt hazırlıyor…') is rendered inside the role="log" aria-live="polite" region where the reply will appear, so it is announced and visible. It is removed when the reply arrives, and the form already has aria-busy. I did not add a nested role=status or aria-busy on the log: either could double or hold back that announcement.

## F905 — Son kullanma alanları ödeme formuyla tutarsız ve önceden doldurulmuş

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/transfers/ClaimForm.tsx:36`     |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:285` |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · consistency / generalizability   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                     |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:misc                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p121)                 |

**Kanıt:** ClaimForm.tsx:36-37 `expMonth: "12", expYear: String(new Date().getUTCFullYear() + 2)` varsayılan olarak dolu. 122-147 iki ayrı `type="number"` alanı (Ay ve Yıl) var. Normal rezervasyon ödemesi ise tek alan kullanıyor: BookingActions.tsx:285-294 `autoComplete="cc-exp"`, etiket 'Son kullanma'.

**Etki:** Normal ödemeyi öğrenmiş misafir burada farklı bir düzenle karşılaşıyor. Önceden dolu son kullanma değeri değiştirilmeden gönderilebiliyor; gerçek bir PSP ile bu ret anlamına gelir. type=number alanında fare tekerleği veya ok tuşu değeri fark edilmeden değiştiriyor, mobilde spinner hedefleri küçük.

**Önerilen aksiyon:** BookingActions ile aynı tek 'Son kullanma (AA/YY)' alanını kullanın: `inputMode="numeric" autoComplete="cc-exp" placeholder="AA/YY"`, varsayılan boş. Ayrıştırmayı tokenize öncesinde yapın. Ortak bir CardFields bileşeni çıkarıp iki formda da kullanın.

**Yapılan düzeltme:** Confirmed: the form pre-filled expiry with month 12 and the current year + 2, using two type=number fields. I replaced the card inputs with the shared <CardFields idPrefix="card">. It has one empty 'Son kullanma (AA/YY)' field with inputMode numeric, autoComplete cc-exp, maxLength 5 and an automatic '/'. Card state is now {number, exp, cvc} and starts empty. Parsing happens before tokenizing via tokenizeCardFields, which runs parseExpiry.

## F906 — Kart doğrulama hataları alanla ilişkilendirilmiyor (aria-invalid yok, odak taşınmıyor)

| Alan                | Değer                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Severity            | Medium                                                            |
| Durum               | Aday                                                              |
| Konum               | `src/components/transfers/ClaimForm.tsx:55`                       |
| Diğer konumlar      | `src/lib/payment/card-token.ts:56`, `src/components/ui/ui.tsx:51` |
| Kullanıcılar        | misafir                                                           |
| Prensip             | accessibility · WCAG 3.3.1 / 1.3.1 Hata Tanımlama                 |
| Sezgisel madde      | H9 — Hata mesajları                                               |
| WCAG                | 3.3.1                                                             |
| Renk/tema           | Hayır                                                             |
| Efor                | S                                                                 |
| Kaynak denetçiler   | area:misc                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p121)                                   |

**Kanıt:** ClaimForm.tsx:55-59 `setFeedback({ error: err instanceof CardValidationError ? err.message : t("invalidCard") })`. Hata 167-169'daki formun ALTINDAKİ Status'te gösteriliyor. Field bileşeni `error` prop'unu destekliyor (ui.tsx:51-68, aria-invalid ve aria-describedby kuruyor) ama 106-159 arasında hiçbir Field'a error geçilmiyor.

**Etki:** CVC veya son kullanma hatasında ekran okuyucu kullanıcısı hata metnini duyuyor ama alan aria-invalid olmadığı için hangi alana döneceğini bulmak zorunda kalıyor. Görsel kullanıcı da hatayı formun sonunda, alandan uzakta görüyor.

**Önerilen aksiyon:** CardValidationError'a `field: 'number' | 'cvc' | 'expiry'` ekleyin. ClaimForm'da `fieldErrors` state tutun ve ilgili Field'a `error={fieldErrors.number}` geçin. setFeedback'ten sonra `document.getElementById('card-' + field)?.focus()` çağırın. Kullanıcı alanı düzenlediğinde o alanın hatasını temizleyin.

**Yapılan düzeltme:** Confirmed: err.message was rendered in the Status under the form and no Field got an error. There is now a fieldErrors state passed to CardFields' errors, so the Field gets aria-invalid and aria-describedby. focusFirstInvalid(formRef) moves focus to the invalid field after render. Editing a field clears its error. Only a tokenizer failure with no specific field still uses the Status message plus focus on card-number.

## F907 — Süresi dolmuş, kullanılmış veya kendi bağlantısı ancak kart girildikten sonra fark ediliyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/transfers/ClaimForm.tsx:80`    |
| Diğer konumlar      | `src/lib/transfer/transfer-service.ts:651`     |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · error prevention / responsiveness |
| Sezgisel madde      | H5 — Hata önleme                               |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | area:misc                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p121)         |

**Kanıt:** ClaimForm.tsx:80 `if (!token && !bookingId)` yalnızca token'ın var olup olmadığına bakıyor. Geçerlilik yalnızca POST sırasında denetleniyor: transfer-service.ts:651-653 'Devir linki geçersiz veya süresi dolmuş', 678-680 'Bu devir artık mevcut değil', 681-683 'Kendi rezervasyonunuzu devralamazsınız'.

**Etki:** Alıcı kart numarası, ay, yıl ve CVC'yi girdikten sonra bağlantının süresinin dolduğunu ya da başkası tarafından alındığını öğreniyor. Satıcının kendi bağlantısını test etmesi de aynı şekilde boşa emek oluyor.

**Önerilen aksiyon:** 1. bulgudaki önizleme ucu sayfa açılışında çağrılsın. Duruma göre kart formu yerine şu durumlar gösterilsin: 'Bağlantının süresi doldu (son: {tarih}), satıcıdan yenisini isteyin', 'Bu rezervasyon başka bir alıcıya devredildi', 'Bu sizin ilanınız; devralamazsınız'. Hepsine /transfers bağlantısı eklensin.

**Yapılan düzeltme:** There is no preview endpoint, so only part of this is fixed. On load, the client now reads the token body's exp field without checking the signature and shows a non-form state when the link is malformed or expired: 'Bu devir bağlantısının süresi {date} itibarıyla doldu. Satıcıdan yeni bir bağlantı isteyin.' Server errors INVALID_TOKEN, ALREADY_CLAIMED (first attempt only) and SELF_CLAIM now replace the card form with a matching state (expired/invalid, gone, own listing). Each state links to /transfers and /trips, and focus moves to the message. Catching 'already claimed' and 'own listing' before the card is entered still needs the preview endpoint requested in crossOwner.

## F908 — Devralma başarılı olunca odak kayboluyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/transfers/ClaimForm.tsx:90` |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · WCAG 2.4.3 Odak Sırası      |
| Sezgisel madde      | H12 — Feedback                              |
| WCAG                | 2.4.3                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:misc                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p121)             |

**Kanıt:** ClaimForm.tsx:90-103 `bookingId ? (<p>…owned…</p>) : (<form>…)`. Başarıdan sonra odaktaki gönder düğmesinin bulunduğu form DOM'dan kalkıyor. Başarı paragrafına odak verilmiyor (ref veya tabIndex yok).

**Etki:** Klavye ve ekran okuyucu kullanıcısında odak body'ye düşüyor. Status mesajı duyurulsa bile 'rezervasyonu görüntüle' bağlantısına ulaşmak için sayfanın başından gezinmek gerekiyor.

**Önerilen aksiyon:** Başarı paragrafına `ref={successRef} tabIndex={-1}` verin. `useEffect(() => { if (bookingId) successRef.current?.focus(); }, [bookingId])` ile odağı oraya taşıyın. İsterseniz paragrafı bir h3 başlığıyla ('Devir tamamlandı') başlatın.

**Yapılan düzeltme:** Confirmed: focus was lost when the form unmounted. On success a block now shows an h3 (ref, tabIndex -1, focusRing) with the existing 'done' text (amount paid), then the 'owned' link paragraph. A useEffect on `done` focuses the heading. The success text moved out of the bottom Status so it is not shown twice.

## F909 — Keşif listesindeki ilanlarda eylem yok (çıkmaz)

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/transfers/TransferMarket.tsx:61` |
| Kullanıcılar        | misafir                                          |
| Prensip             | robustness · task conformance                    |
| Sezgisel madde      | H11 — Affordance                                 |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:misc                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                  |

**Kanıt:** TransferMarket.tsx:61-81 her li yalnızca mülk bağlantısı ve şartlar metni içeriyor; devralma, ilgi bildirme veya satıcıyla iletişim eylemi yok. 53'teki giriş metni 'Devralmak için satıcının size ilettiği özel bağlantıyı açın' diyor. Satıcı adı maskeli (transfer-service.ts:103-105 `A*** B.`).

**Etki:** İndirimli bir ilan gören misafirin satıcıya ulaşma yolu yok. Liste bir eylem vaat edip sunmuyor; misafir mülk sayfasına gidip orada normal fiyatla rezervasyona yönelebilir.

**Önerilen aksiyon:** Her ilana 'Devralmak istiyorum' düğmesi ekleyin. Düğme satıcıya uygulama içi bildirim göndersin ve satıcı bağlantıyı alıcıya iletsin. Bu akış kapsam dışıysa bölüm başlığını 'Devirdeki rezervasyonlar (yalnızca satıcının bağlantısıyla)' yapın ve her ilanın altına 'Bu ilanı ancak satıcının size gönderdiği bağlantıyla devralabilirsiniz' notu ile 'Nasıl çalışır?' bağlantısı koyun.

**Yapılan düzeltme:** There is no notify-the-seller API, so the 'Devralmak istiyorum' button was out of scope and I used the fallback. Each discover item now says the booking can only be taken over through the seller's link (discover.itemNote). The card also has a 'Devir nasıl çalışır?' <details> with 4 steps, and the property-title link that sent guests into the normal booking flow is now plain text.

## F910 — Devredilemez rezervasyonlar (girişe 48 saatten az kalan) seçim listesinde sunuluyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/components/transfers/TransferMarket.tsx:107` |
| Diğer konumlar      | `src/lib/transfer/transfer-service.ts:143`        |
| Kullanıcılar        | misafir                                           |
| Prensip             | robustness · error prevention                     |
| Sezgisel madde      | H5 — Hata önleme                                  |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:misc                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                   |

**Kanıt:** TransferMarket.tsx:107 `(data ?? []).filter((b) => b.status === "CONFIRMED")` yalnızca duruma bakıyor. Sunucu transfer-service.ts:143-150 'Girişe 48 saatten az kalan rezervasyon devredilemez' (TOO_LATE; TRANSFER_MIN_HOURS_BEFORE_CHECKIN=48, app-config.ts:170) hatasıyla reddediyor.

**Etki:** Son dakikada gidemeyeceğini anlayan satıcı rezervasyonu seçip fiyat yazıyor ve ancak gönderimden sonra reddediliyor. Kullanılamayan seçenek seçilebilir durumda kalıyor.

**Önerilen aksiyon:** checkIn - now ≤ 48 saat olan seçeneklere `disabled` verin ve metne '(girişe 48 saatten az; devredilemez)' ekleyin. Tercihen sınır istemciye API'den `transferable` alanı olarak dönülsün. Hiç uygun rezervasyon yoksa sell.none metni gerekçesiyle gösterilsin.

**Yapılan düzeltme:** SellPanel now lists only upcoming CONFIRMED bookings. Bookings with 48h or less to check-in are disabled options with the suffix '(girişe 48 saatten az; devredilemez)', and the default selection is the first transferable booking. When none are transferable, sell.none explains the 48h rule. The check uses an optional API field `transferable` when present and otherwise a 48h client default (crossOwner filed so the API can supply it).

## F911 — Devir fiyatı alanında üst sınır, ödeme ve geçerlilik bilgisi verilmiyor; terim belirsiz

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Medium                                                           |
| Durum               | Aday                                                             |
| Konum               | `src/components/transfers/TransferMarket.tsx:167`                |
| Diğer konumlar      | `messages/tr/transfers.json:21`, `messages/en/transfers.json:22` |
| Kullanıcılar        | misafir                                                          |
| Prensip             | learnability · predictability (feedforward)                      |
| Sezgisel madde      | H13 — Feedforward                                                |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | area:misc                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                                  |

**Kanıt:** TransferMarket.tsx:167-171 etiket `t("sell.askPrice")` = 'İstek fiyatı (TRY)', ipucu 'Ödediğiniz tutarın üst sınırını aşamaz.' (tr/transfers.json:21-22). Gerçek sınır TRANSFER_MAX_ASK_RATIO (app-config.ts:169, 0.1–2 arası ayarlanabilir) ve tutar olarak gösterilmiyor. Yanıttaki `expiresAt` (transfer-service.ts:206) UI'da kullanılmıyor (127-130). Alıcı ödeyince satıcıya ne olacağı anlatılmıyor.

**Etki:** Satıcı 'istek fiyatı' teriminin satış fiyatı mı yoksa teklif mi olduğunu anlamıyor. En fazla kaç TL yazabileceğini bilmediği için sınırı deneme yanılmayla buluyor (ASK_TOO_HIGH). Bağlantının ne zamana kadar geçerli olduğunu ve paranın kendisine nasıl geçeceğini bilmiyor.

**Önerilen aksiyon:** Etiketi 'Satış fiyatı ({currency})' / 'Your price ({currency})' yapın. İpucunu dinamik yazın: `t('sell.askHintMax', { max: f.money(selected.totalPriceMinor, selected.currency) })` ('En fazla {max}'). Sınır oranı istemciye de dönülsün. Başarı mesajına 'Bağlantı {f.dateTime(res.expiresAt)} tarihine kadar geçerli. Alıcı ödeme yapınca rezervasyon ona geçer, tutar size aktarılır.' ekleyin.

**Yapılan düzeltme:** The label is now 'Satış fiyatı ({currency})' / 'Your price ({currency})' and the hint shows the real maximum ('En fazla {max}'). Prices above the maximum are rejected in the browser with a field error (sell.askTooHigh) instead of a server round trip. The success message now gives the link's expiry (f.dateTime(res.expiresAt)) and says the booking moves to the buyer on payment and the amount is paid to the seller. The maximum is an optional API field `maxAskMinor`, falling back to totalPriceMinor (ratio 1).

## F912 — Fiyat alanındaki pattern açıklamasız; Türkçe binlik ayırıcı uyarısız reddediliyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/components/transfers/TransferMarket.tsx:178` |
| Kullanıcılar        | misafir                                           |
| Prensip             | robustness · error prevention / hata mesajı       |
| Sezgisel madde      | H9 — Hata mesajları                               |
| WCAG                | 3.3.3                                             |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:misc                                         |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p125)                  |

**Kanıt:** TransferMarket.tsx:178 `pattern="\d+([.,]\d{1,2})?"` var ama `title` ve biçim ipucu yok. TR kullanıcısının alışık olduğu '1.500' ve '1.500,00' bu desene uymuyor. Tarayıcı yalnızca 'İstenen biçimle eşleşmelidir' gibi genel bir baloncuk gösteriyor. 122'deki `ask.replace(",", ".")` yalnızca ilk virgülü değiştiriyor.

**Etki:** Satıcı '1.500' yazdığında gönderim tarayıcının belirsiz mesajıyla engelleniyor ve neyin yanlış olduğunu anlamıyor. Mobil tarayıcılarda bu baloncuk ekran okuyucuya tutarsız biçimde iletiliyor.

**Önerilen aksiyon:** Field'a örnek içeren bir ipucu ekleyin: 'Örn. 1500 veya 1500,50; binlik ayırıcı kullanmayın'. inputa `title` aynı metni versin. Daha iyisi binlik ayırıcıyı yerel ayara göre ayıklayan bir parseLocaleAmount() yazın, onBlur'da doğrulayın, hatayı Field `error` prop'u ile (aria-invalid) gösterin ve native pattern'i kaldırın.

**Yapılan düzeltme:** The current code has no native pattern any more. The input uses parseAmountToMinor (accepts '1.500' and '1.500,00') and shows errors through the Field error prop (aria-invalid, focus moved to the field), and the hint already gives examples. I kept the examples in the new dynamic hint.

## F913 — 'Devret' düğmesi eylemin sonucunu yanlış anlatıyor

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Medium                                                           |
| Durum               | Aday                                                             |
| Konum               | `src/components/transfers/TransferMarket.tsx:184`                |
| Diğer konumlar      | `messages/tr/transfers.json:23`, `messages/en/transfers.json:23` |
| Kullanıcılar        | misafir                                                          |
| Prensip             | learnability · predictability                                    |
| Sezgisel madde      | H13 — Feedforward                                                |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | area:misc                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                                  |

**Kanıt:** TransferMarket.tsx:183-185 `{t("sell.submit")}` = 'Devret' / 'Transfer' (tr/transfers.json:23). Düğme aslında devir yapmıyor; ilan ve tek kullanımlık bağlantı oluşturuyor (api/transfers/route.ts:13 yorumu).

**Etki:** Satıcı tıklayınca rezervasyonun hemen elden çıkacağını sanıp çekinebilir, ya da tersine devrin tamamlandığını düşünüp bağlantıyı paylaşmayı atlayabilir.

**Önerilen aksiyon:** Düğme metnini 'Devir bağlantısı oluştur' / 'Create transfer link' yapın. Düğmenin altına 'Rezervasyon, alıcı ödeme yapana kadar sizde kalır' notu ekleyin.

**Yapılan düzeltme:** The submit button now reads 'Devir bağlantısı oluştur' / 'Create transfer link'. A note under the form (sell.keepNote, linked to the button via aria-describedby) says the booking stays with the seller until the buyer pays, and the price is paid out once the payment is approved.

## F914 — Rezervasyon devri metni sonucu tahmin ettirmiyor; keşif listesi eyleme dönüşmüyor

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                |
| Durum               | Aday                                                                                                                  |
| Konum               | `src/components/transfers/TransferMarket.tsx:184`                                                                     |
| Diğer konumlar      | `messages/tr/transfers.json:12`, `messages/tr/transfers.json:23`, `src/components/transfers/TransferMarket.tsx:60-80` |
| Kullanıcılar        | misafir                                                                                                               |
| Prensip             | learnability · predictability (feedforward)                                                                           |
| Sezgisel madde      | H13 — Feedforward                                                                                                     |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | S                                                                                                                     |
| Kaynak denetçiler   | lens:copy                                                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                                                                                       |

**Kanıt:** TransferMarket.tsx:184 düğme transfers.json:23 'Devret' — tıklanınca devir gerçekleşmez, yalnız ilan ve tek seferlik bağlantı oluşturur (sell.created/linkOnce); asıl rezervasyona ne olacağı (alıcı ödeyince size iade mi, iptal mi) hiçbir yerde yazmaz. 60-80 keşif listesinde öğeler yalnız ilan sayfasına bağlanır (yeni rezervasyon akışına götürür), devralma eylemi yok; transfers.json:12 '... · son {expires}' belirsiz ('son' = son tarih?).

**Etki:** Misafir rezervasyonunu hemen elden çıkardığını sanabilir ya da keşif listesindeki ilanı devralmaya çalışırken yeni rezervasyon yapar.

**Önerilen aksiyon:** Düğmeyi 'Devir bağlantısı oluştur' yapın ve altına 'Alıcı ödediğinde rezervasyon ona geçer; size {orijinal–komisyon} ödenir' açıklaması ekleyin; keşif öğesine 'Bu ilanı devralmak için satıcıdan bağlantı isteyin' notu koyup ilan bağlantısını kaldırın; 'son' yerine 'Son geçerlilik: {tarih}' yazın.

**Yapılan düzeltme:** Covered by the F913 and F909 changes: new button text and outcome note, a per-item note on how to take over, and the property link removed from discover items. The ambiguous 'son {expires}' is now 'son geçerlilik: {expires}' with date and time. The recommended '{original minus commission}' payout was not used because the code pays the full asking price (transfer-service payout = ask), so the copy says the amount is paid to the seller.

## F1317 — Gezi planlayıcıda örnek şehirler gerçek değer olarak dolu, kısıtlar söylenmiyor, 'Tut (hold)' jargonu

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Low                                        |
| Durum               | Aday                                       |
| Konum               | `src/components/plan/TripPlanner.tsx:48`   |
| Diğer konumlar      | `messages/tr/plan.json`                    |
| Kullanıcılar        | misafir                                    |
| Prensip             | learnability · familiarity, predictability |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                |
| WCAG                | 3.3.2                                      |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | lens:forms                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)            |

**Kanıt:** src/components/plan/TripPlanner.tsx:48 `useState("İstanbul, Kapadokya, Antalya")` örnek veri value olarak; :126-137 gün `max={30}` ama sunucu src/lib/ai/trip-planner.ts:115 'Gün sayısı şehir sayısı ile 30 arasında olmalı' kuralını ekranda yazmıyor; :150-157 başlangıç tarihinde `min` yok. messages/tr/plan.json `"hold": "Tut (hold)"`.

**Etki:** Misafir örnek şehirleri silmeden plan oluşturabilir; 2 şehir 1 gün gibi girdilerde teknik hata alır.

**Önerilen aksiyon:** Örneği placeholder'a taşı ve value'yu boş başlat; gün alanına hint ('şehir sayısı ile 30 arası') ve `min={cityCount}`; tarih `min={isoDay(0)}`; düğme metni 'Odayı ayır'.

**Yapılan düzeltme:** Confirmed. The example cities are no longer a real value, and the field starts empty. The nights field states its 'city count–30' rule in a hint and uses min=cityCount. The date input has min=today. The button text is 'Odayı ayır' instead of 'Tut (hold)'.

## F1318 — Gezi planlayıcıda 'Tut (hold)' düğmesi planı terk ettiriyor; diğer duraklar kayboluyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Aday                                      |
| Konum               | `src/components/plan/TripPlanner.tsx:102` |
| Diğer konumlar      | `messages/tr/plan.json:17`                |
| Kullanıcılar        | misafir                                   |
| Prensip             | flexibility · multithreading              |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü         |
| Renk/tema           | Hayır                                     |
| Efor                | M                                         |
| Kaynak denetçiler   | lens:copy                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p095)           |

**Kanıt:** TripPlanner.tsx:89-110 hold() bir durağı ayırıp hemen `router.push(`/booking/${booking.id}`)` yapar; plan state'i saklanmaz. plan.json:17 'Tut (hold)' TR etikette İngilizce; açıklama (result.note) listenin altında.

**Etki:** Çok duraklı geziyi planlayan misafir ilk durağı ayırdıktan sonra planını kaybeder, diğer şehirler için yeniden plan üretir.

**Önerilen aksiyon:** Tüm durakları sepete ekleyen 'Tüm konaklamaları sepete ekle' eylemi sunun veya hold'u yeni sekmede/plan sayfasında kalarak yapın; etiketi 'Odayı ayır' yapıp notu düğmenin üstüne taşıyın.

**Yapılan düzeltme:** The navigation part was already fixed: hold no longer calls router.push, the plan stays in sessionStorage, and each held stop shows a 'Öde' link. The remaining parts are now done: the TR label is 'Odayı ayır' and the explanatory note sits above the stop list instead of below it. I did not add an 'add all to cart' action, because the plan already stays on the page while holding.

## F1319 — Mesaj göndermek için klavye kısayolu ve mobil enterKeyHint yok

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/support/SupportChat.tsx:122` |
| Kullanıcılar        | misafir                                      |
| Prensip             | flexibility · substitutivity / verimlilik    |
| Sezgisel madde      | H7 — Esneklik/verim                          |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:misc                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p119)       |

**Kanıt:** SupportChat.tsx:122-130 textarea'da onKeyDown yok; Enter yalnızca yeni satır açıyor. Göndermek için Tab ile düğmeye geçmek gerekiyor. `enterKeyHint` tanımlı değil.

**Etki:** Sohbet uygulamalarına alışık klavye kullanıcısı her mesajda düğmeye gitmek zorunda kalıyor. Mobil klavyede 'Gönder' tuşu çıkmıyor.

**Önerilen aksiyon:** onKeyDown'da `(e.ctrlKey || e.metaKey) && e.key === 'Enter'` ise formu gönderin ve bunu ipucuna yazın ('Göndermek için Ctrl+Enter'). Textarea'ya `enterKeyHint="send"` ekleyin.

**Yapılan düzeltme:** The textarea now sends with Ctrl+Enter or Cmd+Enter (IME composition is ignored; plain Enter still adds a new line). The hint text, linked through aria-describedby, gains t("shortcutHint"). I left out `enterKeyHint="send"` on purpose: in this multi-line box Enter adds a new line, so a mobile 'Send' key label would mislead.

## F1320 — Mesaj 1000 karakterde sessizce kesiliyor; sayaç yok

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/support/SupportChat.tsx:127` |
| Kullanıcılar        | misafir                                      |
| Prensip             | robustness · observability                   |
| Sezgisel madde      | H12 — Feedback                               |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:misc                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p119)              |

**Kanıt:** SupportChat.tsx:127 `maxLength={MAX_MESSAGE}` (24: 1000). Kalan karakter sayısı veya sınır uyarısı yok; ipucu (131-133) sınırdan söz etmiyor.

**Etki:** Uzun bir şikâyeti yapıştıran misafirin metni fark ettirmeden kesiliyor ve eksik iletiliyor.

**Önerilen aksiyon:** Textarea altına `{message.length}/1000` sayacı ekleyin ve aria-describedby'ye bağlayın. 900 karakterin üzerinde bir polite duyuru yapın. Yapıştırılan metin kesildiyse 'Mesajınız 1000 karaktere kısaltıldı' uyarısı gösterin.

**Yapılan düzeltme:** Added a visible `{count}/{max} karakter` counter linked to the textarea through aria-describedby. A role=status note announces once, at 100 or fewer characters left, that the limit is near. If a paste would go past 1000 characters, onPaste flags it and the note says the message was shortened to 1000 characters. The flag clears once the text drops below the limit. New keys: counter, nearLimit, truncated.

## F1321 — Geçersiz bağlantı durumunda sonraki adım yok; başarı sonrası yenilemede hata görünüyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/transfers/ClaimForm.tsx:82` |
| Diğer konumlar      | `messages/tr/transfers.json:35`             |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H9 — Hata mesajları                         |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:misc                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p121)             |

**Kanıt:** ClaimForm.tsx:80-86 yalnızca `<p role="alert">{t("invalidLink")}</p>` gösteriyor; bağlantı veya eylem yok. 72 başarıdan sonra `replaceState` ile hash'i siliyor; sayfa yenilenince bookingId state'i de kaybolduğu için aynı uyarı çıkıyor.

**Etki:** Devri başarıyla tamamlayıp sayfayı yenileyen alıcı 'Geçerli bir devir bağlantısı bulunamadı' uyarısını görünce işlemin başarısız olduğunu sanıyor. Hatalı bağlantıyla gelen kullanıcıya gidebileceği bir yer gösterilmiyor.

**Önerilen aksiyon:** Uyarıya iki bağlantı ekleyin: 'Rezervasyonlarım' (/trips) ve 'Devir pazarı' (/transfers). Metne 'Devri tamamladıysanız rezervasyon Rezervasyonlarım sayfasında görünür' cümlesini ekleyin.

**Yapılan düzeltme:** Confirmed: the invalid-link state was a bare red paragraph with no links. It now shows invalidLink plus the new invalidLinkHelp: 'Devri zaten tamamladıysanız rezervasyon Seyahatlerim sayfasında görünür.' Below that are links to /transfers (reusing nav.transfers, 'Devir pazarı') and /trips (reusing titles.trips, 'Seyahatlerim').

## F1322 — Kart ipucunda jargon var; 3DS kartı devirde desteklenmediği halde uyarılmıyor

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Low                                                                 |
| Durum               | Aday                                                                |
| Konum               | `src/components/transfers/ClaimForm.tsx:109`                        |
| Diğer konumlar      | `messages/tr/transfers.json:39`, `src/lib/payment/card-token.ts:63` |
| Kullanıcılar        | misafir                                                             |
| Prensip             | learnability · familiarity                                          |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                         |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | area:misc                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p121)                                     |

**Kanıt:** tr/transfers.json:39 'Kart bilgisi sunucuya gönderilmez; yalnızca token gider.'. card-token.ts:63-64 3DS kartını kabul edip 'tok_mock_3ds' üretiyor. transfer-service.ts:554-556 devirde etkileşimli 3DS adımı olmadığını, requires_action'ın ret sayıldığını belirtiyor. Kullanıcı yalnızca genel 'Ödeme onaylanmadı' mesajını görüyor. BookingActions.tsx:311 rezervasyon ödemesinde 3DS test kartını listeliyor.

**Etki:** Misafir 'token' kelimesini anlamıyor. Rezervasyon ödemesinde 3DS kartını öğrenmiş kullanıcı onu burada kullanınca nedeni açıklanmayan bir ret alıyor ve başarısız deneme sayacı (ATTEMPTS_EXHAUSTED) bir artıyor.

**Önerilen aksiyon:** Metni şöyle değiştirin: 'Kart numaranız sunucumuza ulaşmaz; ödeme sağlayıcısı tek kullanımlık bir kod üretir.' Ek not: 'Ek doğrulama (3D Secure) isteyen kartlar devirde desteklenmez.' Tokenizer 3DS senaryosu döndürürse ClaimForm göndermeden önce bu uyarıyı göstersin.

**Yapılan düzeltme:** Confirmed. I rewrote transfers.claim.cardHint, which only ClaimForm uses, without the word 'token' and with a note that 3D Secure cards are not supported for transfers. After tokenizing, if parseMockToken(cardToken).scenario === '3ds', the form does not send. It shows the new threeDsUnsupported error on the card-number field and focuses it, so the attempt counter is not used up.

## F1323 — Devretme paneli uzun keşif listesinin altında kalıyor; sayfa içi gezinme yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/transfers/TransferMarket.tsx:50` |
| Kullanıcılar        | misafir                                          |
| Prensip             | flexibility · dialog initiative                  |
| Sezgisel madde      | H7 — Esneklik/verim                              |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:misc                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                  |

**Kanıt:** TransferMarket.tsx:50-98 sıralama sabit: önce keşif Card'ı (52-84), sonra SellPanel (86-87). Sayfa başında iki bölüme giden bağlantı yok.

**Etki:** Mobilde rezervasyonunu devretmek için gelen satıcı tüm ilan listesini kaydırarak geçmek zorunda kalıyor.

**Önerilen aksiyon:** PageShell intro'sunun altına iki sayfa içi bağlantı ekleyin: 'Rezervasyonumu devret' (#sell) ve 'İlanlara göz at' (#discover). Oturumu açık kullanıcı için SellPanel'i üstte render etmeyi değerlendirin.

**Yapılan düzeltme:** Added an in-page <nav aria-label='Bu sayfada'> at the top of TransferMarket, shown once the session is ready, with links to #sell (reuses sell.title), #discover ('İlanlara göz at') and, for signed-in users, #my-transfers. The signed-out login prompt now has id='sell' so that link still works. Section order is unchanged.

## F1324 — İlan şartlarında 'son' ifadesi belirsiz; geçerlilik saati gösterilmiyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/transfers/TransferMarket.tsx:76` |
| Diğer konumlar      | `messages/tr/transfers.json:12`                  |
| Kullanıcılar        | misafir                                          |
| Prensip             | learnability · familiarity                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                      |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:misc                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                  |

**Kanıt:** tr/transfers.json:12 '… · satıcı {seller} · son {expires}'. TransferMarket.tsx:76 `expires: f.date(item.expiresAt)` yalnızca tarihi gösteriyor; expiresAt saat de içeriyor ve checkIn ile sınırlanabiliyor (transfer-service.ts:175-180).

**Etki:** 'son 18.10.2026' ifadesi son geçerlilik mi, son giriş mi, anlaşılmıyor. Aynı gün içinde süresi dolacak bir ilan tam gün geçerli sanılıyor.

**Önerilen aksiyon:** Metni '· son geçerlilik: {expires}' yapın ve `f.dateTime(item.expiresAt)` kullanın. Şartları `<dl>` (İstenen / Orijinal / Satıcı / Son geçerlilik) yapısıyla gösterin.

**Yapılan düzeltme:** discover.terms now reads '… · son geçerlilik: {expires}' (EN: 'listing valid until {expires}'), and expires uses f.dateTime(item.expiresAt) so the time is shown. I did not do the optional <dl> restructure.

## F1325 — Devir panelinde rezervasyonlar yüklenirken durum gösterilmiyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Low                                               |
| Durum               | Aday                                              |
| Konum               | `src/components/transfers/TransferMarket.tsx:149` |
| Kullanıcılar        | misafir                                           |
| Prensip             | robustness · observability                        |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                    |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:misc                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p125)                   |

**Kanıt:** TransferMarket.tsx:148-150: /api/bookings yüklenirken `data` null olduğundan ne 'none' metni ne form ne de yükleniyor metni çıkıyor; kartta yalnızca 'Rezervasyonumu devret' başlığı kalıyor. Keşif kartında (55-57) yükleniyor metni var, bu kartta yok.

**Etki:** Yavaş ağda satıcı başlığın altında boş bir kart görüyor ve özelliğin çalışmadığını sanıyor.

**Önerilen aksiyon:** `{data === null && !error && <p className="text-sm text-gray-600" aria-live="polite">{t("discover.loading")}</p>}` ekleyin.

**Yapılan düzeltme:** SellPanel shows the discover.loading text while /api/bookings is still loading (data === null && !error), the same as the other cards.
